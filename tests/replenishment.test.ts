import { describe, expect, it, vi } from "vitest";
import { createDefaultState } from "../src/lib/demo-state";
import { recordOutboundClick, recordQueueDecision } from "../src/lib/metrics";
import { baseOffers } from "../src/lib/offers";
import { formatPriceEvidence } from "../src/lib/price-evidence";
import { extractPriceFromHtml } from "../src/lib/price-scraper";
import { extractSearchCandidatesFromHtml, searchProductPrices } from "../src/lib/product-search";
import {
  buildPurchaseIntent,
  buildReplenishmentQueue,
  buildShoppingListSummary,
  calculateDaysLeft,
  formatShoppingMemo,
  getRecommendedOffers,
  getUrgency,
} from "../src/lib/replenishment";
import type { AppState } from "../src/lib/types";

describe("replenishment domain logic", () => {
  it("adjusts days-left estimates by household and pet usage", () => {
    const state = createDefaultState();
    const catLitter = state.inventory.find((item) => item.id === "cat-litter");

    expect(catLitter).toBeDefined();
    if (!catLitter) throw new Error("cat-litter fixture is missing");
    expect(calculateDaysLeft(catLitter, state.household)).toBe(4);
  });

  it("maps urgency states from days left", () => {
    expect(getUrgency(5)).toBe("danger");
    expect(getUrgency(10)).toBe("warning");
    expect(getUrgency(14)).toBe("safe");
  });

  it("filters conditional offers when household rules disallow them", () => {
    const state = createDefaultState();
    state.household.includeConditionalOffers = false;
    state.activeFilter = "all";

    expect(getRecommendedOffers(state, baseOffers).every((offer) => offer.conditions.length === 0)).toBe(true);
  });

  it("sorts recommended offers by effective price including conditions", () => {
    const state = createDefaultState();
    state.activeFilter = "all";
    const offers = getRecommendedOffers(state, baseOffers);

    expect(offers[0]?.effectivePrice).toBeLessThanOrEqual(offers[1]?.effectivePrice ?? Number.MAX_SAFE_INTEGER);
    expect(offers.some((offer) => offer.conditions.length > 0)).toBe(true);
  });

  it("builds queue entries with estimated revenue and pending decision defaults", () => {
    const state = createDefaultState();
    const queue = buildReplenishmentQueue(state, baseOffers);

    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0]).toMatchObject({
      decision: "pending",
      estimatedRevenue: expect.any(Number),
    });
  });

  it("summarizes actionable shopping list entries", () => {
    const state = createDefaultState();
    const queue = buildReplenishmentQueue(state, baseOffers);
    const summary = buildShoppingListSummary(queue);

    expect(summary.itemCount).toBeGreaterThan(0);
    expect(summary.totalEffectivePrice).toBeGreaterThan(0);
    expect(summary.conditionalCount).toBeGreaterThan(0);
    expect(summary.lines[0]).toContain("実質");
  });

  it("formats a shopping memo with totals and condition count", () => {
    const state = createDefaultState();
    const summary = buildShoppingListSummary(buildReplenishmentQueue(state, baseOffers));
    const memo = formatShoppingMemo(summary);

    expect(memo).toContain("Home Stack 買い物メモ");
    expect(memo).toContain("合計目安:");
    expect(memo).toContain("条件あり:");
    expect(memo).toContain("実質");
  });

  it("allows auto-reserve only when autopilot, item, amount, and condition policy permit it", () => {
    const state: AppState = createDefaultState();
    state.autopilot.enabled = true;
    state.autopilot.maxAmount = 3000;
    state.autopilot.brandPolicy = "allow-same-spec";
    state.autopilot.requireApprovalForConditional = false;
    state.inventory = state.inventory.map((item) => (item.id === "cat-litter" ? { ...item, autoReplenish: true } : item));

    const catEntry = buildReplenishmentQueue(state, baseOffers).find((entry) => entry.item.id === "cat-litter");

    expect(catEntry?.autoReservable).toBe(true);
  });

  it("adds purchase intent confirmation and cancellation windows to queue entries", () => {
    const state = createDefaultState();
    state.autopilot.cancelWindowHours = 12;
    const queue = buildReplenishmentQueue(state, baseOffers);

    expect(queue[0]?.purchaseIntent).toMatchObject({
      status: "confirmation-required",
      confirmationRequired: true,
      cancelWindowHours: 12,
    });

    const confirmed = buildPurchaseIntent({
      decision: "auto-reserve",
      offer: baseOffers[0],
      autopilot: state.autopilot,
      generatedAt: new Date("2026-06-15T00:00:00.000Z"),
    });

    expect(confirmed).toMatchObject({
      status: "confirmed",
      confirmationRequired: false,
      cancelUntil: "2026-06-15T12:00:00.000Z",
    });

    const cancelled = buildPurchaseIntent({
      decision: "cancel",
      offer: baseOffers[0],
      autopilot: state.autopilot,
      generatedAt: new Date("2026-06-15T00:00:00.000Z"),
    });

    expect(cancelled).toMatchObject({ status: "cancelled", confirmationRequired: false });
  });

  it("marks offer prices as demo data with comparison evidence and condition details", () => {
    expect(baseOffers.every((offer) => offer.priceMode === "demo")).toBe(true);
    expect(baseOffers.every((offer) => offer.competitors.length >= 2)).toBe(true);
    expect(baseOffers.every((offer) => offer.comparisonBasis.length > 0)).toBe(true);
    expect(baseOffers.some((offer) => offer.conditions.length > 0)).toBe(true);
  });

  it("formats official campaign window evidence for condition details", () => {
    expect(formatPriceEvidence("official point window expired before fetch")).toBe("ポイント期間: 取得時点でキャンペーン期間が終了済み");
    expect(formatPriceEvidence("official point window starts after fetch")).toBe("ポイント期間: 取得時点ではキャンペーン開始前");
    expect(formatPriceEvidence("official coupon window expired before fetch")).toBe("クーポン期間: 取得時点でキャンペーン期間が終了済み");
    expect(formatPriceEvidence("official coupon window starts after fetch")).toBe("クーポン期間: 取得時点ではキャンペーン開始前");
  });

  it("records outbound clicks and conditional offer revenue", () => {
    const state = createDefaultState();
    state.metrics = {
      clicks: 0,
      conditionalClicks: 0,
      approvals: 0,
      autoReservations: 0,
      estimatedRevenue: 0,
    };

    recordOutboundClick(state.metrics, 2260, 0.08, true);
    recordOutboundClick(state.metrics, 698, 0.025, false);

    expect(state.metrics).toMatchObject({
      clicks: 2,
      conditionalClicks: 1,
      estimatedRevenue: 198,
    });
  });

  it("records only monetized queue decisions in metrics", () => {
    const state = createDefaultState();
    state.metrics = {
      clicks: 0,
      conditionalClicks: 0,
      approvals: 0,
      autoReservations: 0,
      estimatedRevenue: 0,
    };

    recordQueueDecision(state.metrics, "snooze", 181);
    expect(state.metrics).toMatchObject({
      clicks: 0,
      approvals: 0,
      autoReservations: 0,
      estimatedRevenue: 0,
    });

    recordQueueDecision(state.metrics, "approve", 181);
    recordQueueDecision(state.metrics, "auto-reserve", 17);

    expect(state.metrics).toMatchObject({
      clicks: 2,
      approvals: 2,
      autoReservations: 1,
      estimatedRevenue: 198,
    });
  });

  it("extracts live price candidates from product JSON-LD", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Test detergent</title>
          <script type="application/ld+json">
            {"@type":"Product","name":"Test detergent","offers":{"@type":"Offer","price":"698","priceCurrency":"JPY"}}
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({ price: 698, currency: "JPY", source: "json-ld", title: "Test detergent" });
  });

  it("skips used-condition JSON-LD offers before new product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Structured used condition product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Structured used condition product",
              "offers": [
                {
                  "@type": "Offer",
                  "price": "980",
                  "priceCurrency": "JPY",
                  "itemCondition": "https://schema.org/UsedCondition"
                },
                {
                  "@type": "Offer",
                  "price": "1,280",
                  "priceCurrency": "JPY",
                  "itemCondition": "https://schema.org/NewCondition"
                }
              ]
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1280,
      currency: "JPY",
      source: "json-ld",
    });
  });

  it("skips sample JSON-LD offers before regular product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Structured regular product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Structured regular product",
              "offers": [
                {
                  "@type": "Offer",
                  "name": "Sample size product",
                  "price": "300",
                  "priceCurrency": "JPY"
                },
                {
                  "@type": "Offer",
                  "name": "Regular size product",
                  "price": "2,400",
                  "priceCurrency": "JPY"
                }
              ]
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      currency: "JPY",
      source: "json-ld",
    });
  });

  it("does not use JSON-LD aggregate range prices as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Aggregate range product</title>
          <meta property="product:price:amount" content="1,980" />
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Aggregate range product",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "900",
                "highPrice": "1,980",
                "priceCurrency": "JPY",
                "offerCount": 4
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      source: "meta",
    });
  });

  it("skips used embedded JSON prices before new product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Embedded used condition product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "offers": [
                    {
                      "productName": "Embedded used condition product",
                      "currentPrice": "980",
                      "currency": "JPY",
                      "condition": "open-box outlet"
                    },
                    {
                      "productName": "Embedded new condition product",
                      "currentPrice": "1,480",
                      "currency": "JPY",
                      "condition": "new"
                    }
                  ]
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1480,
      currency: "JPY",
      source: "embedded-json",
    });
  });

  it("skips sample embedded JSON prices before regular product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Embedded regular product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "offers": [
                    {
                      "productName": "Trial size detergent",
                      "currentPrice": "300",
                      "currency": "JPY"
                    },
                    {
                      "productName": "Regular size detergent",
                      "currentPrice": "2,400",
                      "currency": "JPY"
                    }
                  ]
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      currency: "JPY",
      source: "embedded-json",
    });
  });

  it("extracts live price effective quotes from product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Conditioned product</title></head>
        <body>
          <span>price 2,000 JPY</span>
          <span>shipping 300</span>
          <span>points 100</span>
          <span>coupon 250</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 2000,
        shippingFee: 300,
        pointValue: 100,
        couponValue: 250,
        effectivePrice: 1950,
        conditionRequired: true,
      },
    });
  });

  it("adds Japanese delivery fees to direct product effective prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Delivery fee product</title></head>
        <body>
          <span>販売価格 1,200円</span>
          <span>配送料 330円</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1200,
      effectivePriceQuote: {
        listPrice: 1200,
        shippingFee: 330,
        effectivePrice: 1530,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料加算"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["shipping fee from page text: 330 JPY"]));
  });

  it("does not double-count shipping-included copy on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Shipping included product</title></head>
        <body>
          <span>item price 2,400 JPY</span>
          <span>shipping included 300 JPY</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 2400,
        shippingFee: 0,
        effectivePrice: 2400,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["shipping fee from page text: 300 JPY"]));
  });

  it("keeps conditional JSON-LD shipping fees out of effective prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Region conditional shipping product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Region conditional shipping product",
              "offers": {
                "@type": "Offer",
                "price": "1,800",
                "priceCurrency": "JPY",
                "shippingDetails": {
                  "@type": "OfferShippingDetails",
                  "shippingRate": { "@type": "MonetaryAmount", "value": 550, "currency": "JPY" },
                  "description": "北海道・沖縄・離島は送料が変わるため注文確認画面で計算"
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1800,
      source: "json-ld",
      effectivePriceQuote: {
        listPrice: 1800,
        shippingFee: 0,
        effectivePrice: 1800,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["shipping fee from JSON-LD: 550 JPY"]));
  });

  it("does not double-count shipping-included JSON-LD shipping rates", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Shipping included JSON-LD product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Shipping included JSON-LD product",
              "offers": {
                "@type": "Offer",
                "price": "2,400",
                "priceCurrency": "JPY",
                "shippingDetails": {
                  "@type": "OfferShippingDetails",
                  "shippingRate": { "@type": "MonetaryAmount", "value": 330, "currency": "JPY" },
                  "description": "shipping included in item price"
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "json-ld",
      effectivePriceQuote: {
        listPrice: 2400,
        shippingFee: 0,
        effectivePrice: 2400,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["shipping fee from JSON-LD: 330 JPY"]));
  });

  it("keeps conditional embedded JSON shipping fees out of effective prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Checkout conditional shipping product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Checkout conditional shipping product",
                    "currentPrice": "2,200",
                    "currency": "JPY",
                    "shippingFee": 660,
                    "shippingNote": "delivery fee varies by region and is calculated at checkout"
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2200,
      source: "embedded-json",
      effectivePriceQuote: {
        listPrice: 2200,
        shippingFee: 0,
        effectivePrice: 2200,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["shipping fee from embedded JSON: 660 JPY"]));
  });

  it("does not double-count shipping-included embedded JSON shipping fees", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Shipping included embedded product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Shipping included embedded product",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "shippingFee": 330,
                    "shippingNote": "shipping included in item price"
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        listPrice: 2400,
        shippingFee: 0,
        effectivePrice: 2400,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["shipping fee from embedded JSON: 330 JPY"]));
  });

  it("skips unit prices before product totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Unit price product</title></head>
        <body>
          <span>単価 128円 / 100g</span>
          <strong>価格 1,280円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1280,
      source: "html-text",
    });
  });

  it("skips pack component prices before set totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Set total product</title></head>
        <body>
          <span>単品 80円 × 12本</span>
          <strong>ケース価格 960円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 960,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 960,
        effectivePrice: 960,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["購入条件あり"]));
  });

  it("skips sample and trial prices before direct product totals", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Full size product</title></head>
        <body>
          <span>sample price 300 JPY</span>
          <span>trial size 500 JPY</span>
          <strong>item price 2,400 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 2400,
        effectivePrice: 2400,
      },
    });
  });

  it("skips second-item promo prices before direct product totals", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Second item promo product</title></head>
        <body>
          <span>2点目価格 680円</span>
          <span>additional item only 780 JPY</span>
          <strong>販売価格 1,580円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1580,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 1580,
        effectivePrice: 1580,
      },
    });
  });

  it("skips discount amounts before product totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Discount product</title></head>
        <body>
          <span>クーポン 300円OFF</span>
          <strong>販売価格 1,280円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1280,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 1280,
        couponValue: 300,
        effectivePrice: 980,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン適用"]));
  });

  it("skips savings amounts before product totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Quantity savings product</title></head>
        <body>
          <span>Save 300 JPY when buying 2 or more</span>
          <strong>Current price 1,280 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Quantity savings product",
      price: 1280,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["購入条件あり"]));
  });

  it("keeps capped point amounts out of effective prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Point cap product</title></head>
        <body>
          <span>Points capped at 1,000 JPY during campaign</span>
          <strong>Current price 5,000 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 5000,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 5000,
        effectivePrice: 5000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.pointValue).toBe(0);
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["point condition requires retailer confirmation"]));
  });

  it("keeps capped coupon amounts out of effective prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Coupon cap product</title></head>
        <body>
          <span>Coupon savings cap 500 JPY for selected sellers</span>
          <strong>Current price 2,000 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 2000,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.couponValue).toBe(0);
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
  });

  it("skips tax-excluded prices before tax-included totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Tax included product</title></head>
        <body>
          <span>税抜 1,000円</span>
          <strong>税込 1,100円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1100,
      source: "html-text",
    });
  });

  it("skips parenthesized tax-excluded prices before tax-included totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Parenthesized tax included product</title></head>
        <body>
          <span>1,000円（税抜）</span>
          <strong>1,100円（税込）</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1100,
      source: "html-text",
    });
  });

  it("skips colon-separated tax-excluded prices before tax-included totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Colon tax included product</title></head>
        <body>
          <span>税抜価格: 1,000円</span>
          <strong>税込価格: 1,100円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1100,
      source: "html-text",
    });
  });

  it("skips plus-tax prices before tax-included totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Plus tax product</title></head>
        <body>
          <span>1,000円+税</span>
          <strong>税込 1,100円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1100,
      source: "html-text",
    });
  });

  it("skips English tax-not-included prices before tax-included totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Tax not included product</title></head>
        <body>
          <span>1,000 JPY tax not included</span>
          <strong>1,100 JPY tax included</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1100,
      source: "html-text",
    });
  });

  it("skips reference prices before sale totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Sale product</title></head>
        <body>
          <span>通常価格 2,000円</span>
          <strong>販売価格 1,500円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      source: "html-text",
    });
  });

  it("skips colon-separated reference prices before sale totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Colon sale product</title></head>
        <body>
          <span>通常価格: 2,000円</span>
          <strong>販売価格: 1,500円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      source: "html-text",
    });
  });

  it("skips MSRP reference prices before sale totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>MSRP reference product</title></head>
        <body>
          <span>MSRP: 2,400 JPY</span>
          <strong>Sale price 1,680 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1680,
      effectivePriceQuote: {
        listPrice: 1680,
        effectivePrice: 1680,
      },
      source: "html-text",
    });
  });

  it("skips expired sale prices before current direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Current sale product</title></head>
        <body>
          <span>タイムセール終了 980円</span>
          <strong>販売価格 1,480円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1480,
      effectivePriceQuote: {
        listPrice: 1480,
        effectivePrice: 1480,
      },
      source: "html-text",
    });
  });

  it("skips used or open-box prices before new direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>New condition product</title></head>
        <body>
          <span>開封済み アウトレット 980円</span>
          <strong>新品 販売価格 1,480円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1480,
      effectivePriceQuote: {
        listPrice: 1480,
        effectivePrice: 1480,
      },
      source: "html-text",
    });
  });

  it("skips used data-attribute prices before new attribute prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Attribute condition product</title></head>
        <body>
          <button data-current-price="980" data-condition="used open box">中古を購入</button>
          <button data-current-price="1,480" data-condition="new">新品を購入</button>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1480,
      source: "data-attribute",
    });
  });

  it("skips sample data-attribute prices before regular attribute prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Attribute regular product</title></head>
        <body>
          <button data-current-price="300" data-label="sample size product">Try sample</button>
          <button data-current-price="2,400" data-label="regular item price">Buy regular</button>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "data-attribute",
    });
  });

  it("skips app-only data-attribute prices before regular attribute prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Attribute app-only product</title></head>
        <body>
          <button data-current-price="1,700" data-label="app-only price">Buy in app</button>
          <button data-current-price="2,080" data-label="regular item price">Buy now</button>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2080,
      source: "data-attribute",
    });
  });

  it("skips range lower-bound prices before exact direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Range lower bound product</title></head>
        <body>
          <span>バリエーション 980円〜</span>
          <strong>販売価格 1,500円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        effectivePrice: 1500,
      },
      source: "html-text",
    });
  });

  it("skips lowest-price range labels before exact direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Lowest range product</title></head>
        <body>
          <span>Lowest price 980 JPY among variants</span>
          <strong>Current price 1,500 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        effectivePrice: 1500,
      },
      source: "html-text",
    });
  });

  it("skips installment amounts before direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Installment product</title></head>
        <body>
          <span>月々500円からの分割払い</span>
          <strong>販売価格 1,980円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
      source: "html-text",
    });
  });

  it("skips per-month financing amounts before direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Financing product</title></head>
        <body>
          <span>Payment plan 500 JPY per mo.</span>
          <strong>Current price 1,980 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
      source: "html-text",
    });
  });

  it("skips payment fee amounts before direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Fee copy product</title></head>
        <body>
          <span>代引手数料 330円</span>
          <strong>販売価格 1,980円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
      source: "html-text",
    });
  });

  it("skips cash-on-delivery fee amounts before direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>COD fee product</title></head>
        <body>
          <span>330 JPY cash on delivery fee</span>
          <strong>item price 1,980 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
      source: "html-text",
    });
  });

  it("skips deposit and future-credit amounts before direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Future credit product</title></head>
        <body>
          <span>ボトル保証金 500円</span>
          <span>次回使えるギフト券 700円分</span>
          <span>store credit 300 JPY for next order</span>
          <strong>販売価格 1,980円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
      source: "html-text",
    });
  });

  it("skips warranty and gift-wrap add-on amounts before direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Add-on service product</title></head>
        <body>
          <span>extended warranty 500 JPY</span>
          <span>gift wrapping 300 JPY</span>
          <strong>item price 1,980 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
      source: "html-text",
    });
  });

  it("skips rental, repair, and restocking service amounts before direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Service fee product</title></head>
        <body>
          <span>rental fee 800 JPY</span>
          <span>repair service 700 JPY</span>
          <span>restocking fee 400 JPY</span>
          <strong>item price 2,480 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2480,
      effectivePriceQuote: {
        listPrice: 2480,
        effectivePrice: 2480,
      },
      source: "html-text",
    });
  });

  it("skips unavailable prices before available totals on direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Available product</title></head>
        <body>
          <span>在庫なし 980円</span>
          <strong>販売中 1,280円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1280,
      source: "html-text",
    });
  });

  it("skips preorder and restock-pending prices before available direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Available now product</title></head>
        <body>
          <span>予約価格 980円 発売前</span>
          <span>入荷予定 1,080円</span>
          <strong>販売価格 1,480円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1480,
      effectivePriceQuote: {
        listPrice: 1480,
        effectivePrice: 1480,
      },
      source: "html-text",
    });
  });

  it("does not deduct ambiguous max reward claims from broad product page text", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Ambiguous reward product</title></head>
        <body>
          <span>price 1,000 JPY</span>
          <span>up to 50% points after entry required</span>
          <span>coupon 最大 900円 対象者限定</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 1000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
  });

  it("does not treat point multipliers as guaranteed direct-page yen discounts", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Point multiplier product</title></head>
        <body>
          <span>price 1,200 JPY</span>
          <span>points 10x today</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1200,
      effectivePriceQuote: {
        listPrice: 1200,
        pointValue: 0,
        effectivePrice: 1200,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["point condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["point value from page text: 10 JPY"]));
  });

  it("marks oversized direct-page rewards conditional instead of deducting them", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Oversized reward product</title></head>
        <body>
          <span>price 1,000 JPY</span>
          <span>points 900 JPY</span>
          <span>coupon 900 JPY</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 1000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from page text: 900 JPY", "coupon value from page text: 900 JPY"]),
    );
  });

  it("does not deduct threshold coupon claims from broad product page text", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Threshold coupon product</title></head>
        <body>
          <span>price 1,200 JPY</span>
          <span>coupon 300 JPY when buying 2 or more</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1200,
      effectivePriceQuote: {
        listPrice: 1200,
        couponValue: 0,
        effectivePrice: 1200,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["coupon value from page text: 300 JPY"]));
  });

  it("does not deduct coupon-code discounts from direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Coupon code product</title></head>
        <body>
          <span>price 1,200 JPY</span>
          <span>クーポンコード入力で300円OFF</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1200,
      effectivePriceQuote: {
        listPrice: 1200,
        couponValue: 0,
        effectivePrice: 1200,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["coupon value from page text: 300 JPY"]));
  });

  it("does not use coupon-code applied prices as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Coupon applied price product</title></head>
        <body>
          <span>クーポンコード適用後価格 1,700円</span>
          <strong>通常販売価格 2,000円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["coupon value from page text: 300 JPY"]));
  });

  it("does not use promo-code applied prices as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Promo applied price product</title></head>
        <body>
          <span>promo code applied price 1,700 JPY</span>
          <strong>item price 2,000 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
  });

  it("does not use clipped discount prices as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Clipped discount price product</title></head>
        <body>
          <span>discount after clip 1,300 JPY</span>
          <strong>item price 2,000 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
  });

  it("does not use coupon threshold amounts as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Japanese coupon threshold product</title></head>
        <body>
          <span>3,000円以上で使える300円クーポン</span>
          <strong>販売価格 1,500円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        couponValue: 0,
        effectivePrice: 1500,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["coupon value from page text: 300 JPY"]));
  });

  it("does not deduct login or app-only reward claims from direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Login reward product</title></head>
        <body>
          <span>price 1,500 JPY</span>
          <span>ポイント 120円分 ログイン後に獲得予定</span>
          <span>クーポン 300円 アプリ限定</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 1500,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from page text: 120 JPY", "coupon value from page text: 300 JPY"]),
    );
  });

  it("skips cart-only direct prices and keeps seller confirmation required", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Cart-only detergent</title></head>
        <body>
          <span>Add to cart to see price 1,180 JPY</span>
          <span>${".".repeat(80)}</span>
          <strong>Item price 1,580 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1580,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 1580,
        effectivePrice: 1580,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["purchase condition requires retailer confirmation"]));
  });

  it("does not use point reward amounts as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Reward amount before price product</title></head>
        <body>
          <span>ポイント 120円分 ログイン後に獲得予定</span>
          <strong>販売価格 1,500円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        pointValue: 0,
        effectivePrice: 1500,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["point condition requires retailer confirmation"]));
  });

  it("does not use effective reward-copy amounts as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Effective reward copy before price product</title></head>
        <body>
          <span>実質 980円 ポイント還元後</span>
          <span>ポイント 520円相当</span>
          <strong>販売価格 1,500円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        pointValue: 520,
        effectivePrice: 980,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント還元込み"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["point value from page text: 520 JPY"]));
  });

  it("does not deduct delayed points or first-order coupons from direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Delayed reward product</title></head>
        <body>
          <span>price 2,000 JPY</span>
          <span>PayPayポイント 150円相当 後日付与・付与上限あり</span>
          <span>初回限定クーポン 300円OFF</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from page text: 150 JPY", "coupon value from page text: 300 JPY"]),
    );
  });

  it("does not deduct mail-in rebate rewards from direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Mail-in rebate product</title></head>
        <body>
          <span>price 2,400 JPY</span>
          <span>points 200 JPY mail-in rebate claim required after checkout</span>
          <span>coupon 300 JPY rebate form after approval</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 2400,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from page text: 200 JPY", "coupon value from page text: 300 JPY"]),
    );
  });

  it("does not deduct next-purchase rewards from direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Next purchase reward product</title></head>
        <body>
          <span>price 2,000 JPY</span>
          <span>ポイント 200円分 次回購入で利用可</span>
          <span>coupon 300 JPY store credit for future purchase</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from page text: 200 JPY", "coupon value from page text: 300 JPY"]),
    );
  });

  it("does not deduct review, selected-store, or payment-limited rewards from direct product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Limited reward product</title></head>
        <body>
          <span>販売価格 2,000円</span>
          <span>レビュー投稿でポイント 200円相当</span>
          <span>対象ストア限定 クーポン 300円OFF</span>
          <span>指定カード決済で discount 100 JPY</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from page text: 200 JPY", "coupon value from page text: 300 JPY"]),
    );
  });

  it("does not use survey or referral rewards as direct product prices or guaranteed discounts", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Referral reward product</title></head>
        <body>
          <span>500 JPY referral coupon after inviting a friend</span>
          <span>survey reward points 200 JPY after questionnaire</span>
          <strong>item price 2,400 JPY</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      effectivePriceQuote: {
        listPrice: 2400,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from page text: 200 JPY", "coupon value from page text: 500 JPY"]),
    );
  });

  it("marks subscription and first-order direct prices as purchase conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Subscription product</title></head>
        <body>
          <span>定期おトク便 初回限定 price 1,180 JPY</span>
          <span>まとめ買いセット対象</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1180,
      effectivePriceQuote: {
        listPrice: 1180,
        effectivePrice: 1180,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["購入条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["purchase condition requires retailer confirmation"]));
  });

  it("keeps conditional free-shipping thresholds as retailer-confirmed conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Conditional shipping product</title></head>
        <body>
          <span>price 1,000 JPY</span>
          <span>free shipping on orders over 3,980 JPY</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        shippingFee: 0,
        effectivePrice: 1000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
  });

  it("does not use free-shipping threshold amounts as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Shipping threshold product</title></head>
        <body>
          <span>送料無料ライン 3,980円以上</span>
          <strong>販売価格 1,280円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
  });

  it("does not use free-shipping remaining amounts as direct product prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Shipping progress product</title></head>
        <body>
          <span>あと500円で送料無料</span>
          <strong>販売価格 1,280円</strong>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
  });

  it("keeps separate or unknown shipping as retailer-confirmed conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Separate shipping product</title></head>
        <body>
          <span>price 1,000 JPY</span>
          <span>送料別途・地域により要確認</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        effectivePrice: 1000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(expect.arrayContaining(["shipping fee from page text: 1,000 JPY"]));
  });

  it("extracts structured shipping, point, and coupon evidence from product JSON-LD", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Structured product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Structured product",
              "offers": {
                "@type": "Offer",
                "price": "2,000",
                "priceCurrency": "JPY",
                "shippingDetails": { "shippingRate": { "value": "300", "currency": "JPY" } },
                "additionalProperty": [
                  { "name": "points", "value": "100" },
                  { "name": "coupon", "value": "250" }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "json-ld",
      effectivePriceQuote: {
        shippingFee: 300,
        pointValue: 100,
        couponValue: 250,
        effectivePrice: 1950,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining([
        "shipping fee from JSON-LD: 300 JPY",
        "point value from JSON-LD: 100 JPY",
        "coupon value from JSON-LD: 250 JPY",
      ]),
    );
  });

  it("keeps conditional JSON-LD rewards as retailer-confirmed conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Conditional structured product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Conditional structured product",
              "offers": {
                "@type": "Offer",
                "price": "2,000",
                "priceCurrency": "JPY",
                "additionalProperty": [
                  { "name": "points", "value": "最大150ポイント 要エントリー" },
                  { "name": "coupon", "value": "初回限定クーポン 300円" }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "json-ld",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from JSON-LD: 150 JPY", "coupon value from JSON-LD: 300 JPY"]),
    );
  });

  it("keeps numeric JSON-LD rewards conditional when eligibility text is in the same record", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Numeric conditional structured product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Numeric conditional structured product",
              "offers": {
                "@type": "Offer",
                "price": "2,000",
                "priceCurrency": "JPY",
                "additionalProperty": [
                  { "name": "points", "value": 150, "description": "review required after purchase" },
                  { "name": "coupon", "value": 300, "description": "selected sellers only" }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "json-ld",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from JSON-LD: 150 JPY", "coupon value from JSON-LD: 300 JPY"]),
    );
  });

  it("keeps numeric JSON-LD rewards conditional when the offer has purchase conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Structured subscription reward product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Structured subscription reward product",
              "offers": {
                "@type": "Offer",
                "price": "2,000",
                "priceCurrency": "JPY",
                "description": "Subscribe & Save first order offer",
                "additionalProperty": [
                  { "name": "points", "value": 150 },
                  { "name": "coupon", "value": 300 }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "json-ld",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from JSON-LD: 150 JPY", "coupon value from JSON-LD: 300 JPY"]),
    );
  });

  it("keeps structured rebate rewards conditional when claim text is in the same record", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Structured rebate product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Structured rebate product",
              "offers": {
                "@type": "Offer",
                "price": "2,400",
                "priceCurrency": "JPY",
                "additionalProperty": [
                  { "name": "points", "value": 200, "description": "mail-in rebate claim required after checkout" },
                  { "name": "coupon", "value": 300, "description": "rebate form after approval" }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "json-ld",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from JSON-LD: 200 JPY", "coupon value from JSON-LD: 300 JPY"]),
    );
  });

  it("does not treat JSON-LD reward date strings as coupon or point values", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Structured reward date product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Structured reward date product",
              "offers": {
                "@type": "Offer",
                "price": "2,000",
                "priceCurrency": "JPY",
                "additionalProperty": [
                  { "name": "points", "value": "valid through 2026-06-20" },
                  { "name": "coupon", "value": "expires 2026-06-20" }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "json-ld",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from JSON-LD: 2026 JPY", "coupon value from JSON-LD: 2026 JPY"]),
    );
  });

  it("deducts active JSON-LD campaign rewards while keeping period conditions visible", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Active structured campaign product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Active structured campaign product",
              "offers": {
                "@type": "Offer",
                "price": "2,000",
                "priceCurrency": "JPY",
                "additionalProperty": [
                  { "name": "points", "value": 150, "validFrom": "2020-01-01T00:00:00+09:00", "validThrough": "2999-01-01T00:00:00+09:00" },
                  { "name": "coupon", "value": 300, "startTime": "2020-01-01T00:00:00+09:00", "endTime": "2999-01-01T00:00:00+09:00" }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "json-ld",
      effectivePriceQuote: {
        pointValue: 150,
        couponValue: 300,
        effectivePrice: 1550,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining([
        "point value from JSON-LD: 150 JPY",
        "point condition requires retailer confirmation",
        "coupon value from JSON-LD: 300 JPY",
        "coupon condition requires retailer confirmation",
      ]),
    );
  });

  it("keeps inactive JSON-LD campaign rewards out of effective prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Inactive structured campaign product</title>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Inactive structured campaign product",
              "offers": {
                "@type": "Offer",
                "price": "2,000",
                "priceCurrency": "JPY",
                "additionalProperty": [
                  { "name": "points", "value": 150, "validThrough": "2020-01-01T00:00:00+09:00" },
                  { "name": "coupon", "value": 300, "startTime": "2999-01-01T00:00:00+09:00" }
                ]
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2000,
      source: "json-ld",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from JSON-LD: 150 JPY", "coupon value from JSON-LD: 300 JPY"]),
    );
  });

  it("extracts meta tag price condition evidence from product pages", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Meta product</title>
          <meta property="product:price:amount" content="1,980" />
          <meta property="product:shipping:amount" content="330" />
          <meta name="product:points" content="120" />
          <meta name="product:coupon" content="200" />
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      source: "meta",
      effectivePriceQuote: {
        shippingFee: 330,
        pointValue: 120,
        couponValue: 200,
        effectivePrice: 1990,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining([
        "shipping fee from meta tag: 330 JPY",
        "point value from meta tag: 120 JPY",
        "coupon value from meta tag: 200 JPY",
      ]),
    );
  });

  it("keeps conditional meta rewards as retailer-confirmed conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Conditional meta product</title>
          <meta property="product:price:amount" content="1,980" />
          <meta name="product:points" content="PayPayポイント 120円相当 後日付与" />
          <meta name="product:coupon" content="LINE限定クーポン 200円" />
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1980,
      source: "meta",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 1980,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from meta tag: 120 JPY", "coupon value from meta tag: 200 JPY"]),
    );
  });

  it("extracts effective quotes from embedded app-state JSON", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Embedded product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Embedded detergent",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "shippingFee": { "amount": "300" },
                    "points": { "amount": "120" },
                    "coupon": { "amount": "200" }
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        shippingFee: 300,
        pointValue: 120,
        couponValue: 200,
        effectivePrice: 2380,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining([
        "shipping fee from embedded JSON: 300 JPY",
        "point value from embedded JSON: 120 JPY",
        "coupon value from embedded JSON: 200 JPY",
      ]),
    );
  });

  it("keeps conditional embedded JSON rewards as retailer-confirmed conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Conditional embedded product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Conditional embedded detergent",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "points": { "amount": "PayPayポイント 150円相当 付与上限あり" },
                    "coupon": { "amount": "初回限定クーポン 300円OFF" }
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from embedded JSON: 150 JPY", "coupon value from embedded JSON: 300 JPY"]),
    );
  });

  it("keeps numeric embedded JSON rewards conditional when eligibility text is in the same record", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Numeric conditional embedded product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Numeric conditional embedded detergent",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "points": { "amount": 120, "description": "レビュー投稿後に付与" },
                    "coupon": { "amount": 200, "eligibility": "payment method selected sellers only" }
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from embedded JSON: 120 JPY", "coupon value from embedded JSON: 200 JPY"]),
    );
  });

  it("keeps numeric embedded JSON rewards conditional when the product has purchase conditions", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Embedded subscription reward product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Embedded subscription detergent",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "purchaseNote": "定期おトク便 初回限定 offer",
                    "points": { "amount": 120 },
                    "coupon": { "amount": 200 }
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from embedded JSON: 120 JPY", "coupon value from embedded JSON: 200 JPY"]),
    );
  });

  it("does not treat embedded reward date strings as coupon or point values", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Embedded reward date product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Embedded reward date detergent",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "points": { "amount": "valid through 2026-06-20" },
                    "coupon": { "amount": "expires 2026-06-20" }
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from embedded JSON: 2026 JPY", "coupon value from embedded JSON: 2026 JPY"]),
    );
  });

  it("deducts active embedded JSON campaign rewards while keeping period conditions visible", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Active embedded campaign product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Active embedded campaign detergent",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "points": { "amount": 120, "validFrom": "2020-01-01T00:00:00+09:00", "validThrough": "2999-01-01T00:00:00+09:00" },
                    "coupon": { "amount": 200, "startTime": "2020-01-01T00:00:00+09:00", "endTime": "2999-01-01T00:00:00+09:00" }
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        pointValue: 120,
        couponValue: 200,
        effectivePrice: 2080,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining([
        "point value from embedded JSON: 120 JPY",
        "point condition requires retailer confirmation",
        "coupon value from embedded JSON: 200 JPY",
        "coupon condition requires retailer confirmation",
      ]),
    );
  });

  it("keeps inactive embedded JSON campaign rewards out of effective prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head>
          <title>Inactive embedded campaign product</title>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "product": {
                    "productName": "Inactive embedded campaign detergent",
                    "currentPrice": "2,400",
                    "currency": "JPY",
                    "points": { "amount": 120, "validThrough": "2020-01-01T00:00:00+09:00" },
                    "coupon": { "amount": 200, "startTime": "2999-01-01T00:00:00+09:00" }
                  }
                }
              }
            }
          </script>
        </head>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 2400,
      source: "embedded-json",
      effectivePriceQuote: {
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.evidence).not.toEqual(
      expect.arrayContaining(["point value from embedded JSON: 120 JPY", "coupon value from embedded JSON: 200 JPY"]),
    );
  });

  it("extracts prices from data attributes before broad page text", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Data attribute product</title></head>
        <body>
          <div data-price="1,580" data-currency="JPY">Cart price</div>
          <span>shipping 220</span>
          <span>points 80</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1580,
      source: "data-attribute",
      effectivePriceQuote: {
        shippingFee: 220,
        pointValue: 80,
        effectivePrice: 1720,
      },
    });
  });

  it("extracts Amazon-style product prices before broad text fallback", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon detergent</title></head>
        <body>
          <span class="a-price a-text-price">
            <span class="a-offscreen">￥3,980</span>
          </span>
          <span class="a-price">
            <span class="a-offscreen">￥2,480</span>
          </span>
          <span>free shipping with prime membership</span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Amazon detergent",
      price: 2480,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 2480,
        shippingFee: 0,
        effectivePrice: 2480,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(
      expect.arrayContaining(["price from Amazon a-offscreen", "shipping condition requires retailer confirmation"]),
    );
    expect(extracted.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
  });

  it("skips Amazon subscribe-and-save prices before one-time prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon one-time detergent</title></head>
        <body>
          <section>
            <span>Subscribe & Save subscription price</span>
            <span class="a-price">
              <span class="a-offscreen">￥1,080</span>
            </span>
          </section>
          <section>${".".repeat(260)}
            <span>One-time purchase</span>
            <span class="a-price">
              <span class="a-offscreen">￥1,480</span>
            </span>
          </section>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Amazon one-time detergent",
      price: 1480,
      source: "html-text",
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["price from Amazon a-offscreen"]));
  });

  it("skips Amazon coupon-applied prices before one-time prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon coupon detergent</title></head>
        <body>
          <section>
            <span>Coupon applied price with clipped coupon</span>
            <span class="a-price">
              <span class="a-offscreen">￥1,180</span>
            </span>
          </section>
          <section>${".".repeat(260)}
            <span>One-time purchase price</span>
            <span class="a-price">
              <span class="a-offscreen">￥1,580</span>
            </span>
          </section>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Amazon coupon detergent",
      price: 1580,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 1580,
        couponValue: 0,
        effectivePrice: 1580,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["price from Amazon a-offscreen"]));
  });

  it("skips Amazon member-only prices before one-time prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon member detergent</title></head>
        <body>
          <section>
            <span>Prime member-only price</span>
            <span class="a-price">
              <span class="a-offscreen">・･1,180</span>
            </span>
          </section>
          <section>${".".repeat(260)}
            <span>One-time purchase price</span>
            <span class="a-price">
              <span class="a-offscreen">・･1,580</span>
            </span>
          </section>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Amazon member detergent",
      price: 1580,
      source: "html-text",
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["price from Amazon a-offscreen"]));
  });

  it("skips Amazon cart-only prices before one-time prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon cart detergent</title></head>
        <body>
          <section>
            <span>Add to cart to see price</span>
            <span class="a-price">
              <span class="a-offscreen">・･1,180</span>
            </span>
          </section>
          <section>${".".repeat(260)}
            <span>One-time purchase price</span>
            <span class="a-price">
              <span class="a-offscreen">・･1,580</span>
            </span>
          </section>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Amazon cart detergent",
      price: 1580,
      source: "html-text",
      effectivePriceQuote: {
        listPrice: 1580,
        effectivePrice: 1580,
        conditionRequired: true,
      },
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["purchase condition requires retailer confirmation"]));
  });

  it("skips Amazon used offer prices before new split prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon new wipes</title></head>
        <body>
          <section>
            <span>Used open box offer</span>
            <span class="a-price">
              <span class="a-price-symbol">￥</span>
              <span class="a-price-whole">980</span>
              <span class="a-price-decimal">.</span>
              <span class="a-price-fraction">00</span>
            </span>
          </section>
          <section>${".".repeat(260)}
            <span>New item price</span>
            <span class="a-price">
              <span class="a-price-symbol">￥</span>
              <span class="a-price-whole">1,280</span>
              <span class="a-price-decimal">.</span>
              <span class="a-price-fraction">00</span>
            </span>
          </section>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Amazon new wipes",
      price: 1280,
      source: "html-text",
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["price from Amazon split whole/fraction"]));
  });

  it("skips Amazon unavailable machine-state prices before current offers", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon current detergent</title></head>
        <body>
          <section>
            <span>availability: out_of_stock</span>
            <span class="a-price">
              <span class="a-offscreen">￥780</span>
            </span>
          </section>
          <section>${".".repeat(260)}
            <span>availability: in_stock</span>
            <span>One-time purchase price</span>
            <span class="a-price">
              <span class="a-offscreen">￥1,580</span>
            </span>
          </section>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      title: "Amazon current detergent",
      price: 1580,
      source: "html-text",
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["price from Amazon a-offscreen"]));
  });

  it("extracts Amazon split whole and fraction prices", () => {
    const extracted = extractPriceFromHtml(`
      <html>
        <head><title>Amazon wipes</title></head>
        <body>
          <span class="a-price">
            <span class="a-price-symbol">￥</span>
            <span class="a-price-whole">1,280</span>
            <span class="a-price-decimal">.</span>
            <span class="a-price-fraction">00</span>
          </span>
        </body>
      </html>
    `);

    expect(extracted).toMatchObject({
      price: 1280,
      source: "html-text",
    });
    expect(extracted.effectivePriceQuote?.evidence).toEqual(expect.arrayContaining(["price from Amazon split whole/fraction"]));
  });

  it("extracts product search candidates from marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/123" title="ライオン 猫砂 5L">ライオン 猫砂 5L</a>
          <span>送料無料</span>
          <strong>¥748</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/cat-litter/",
    );

    expect(candidates[0]).toMatchObject({
      source: "rakuten",
      title: "ライオン 猫砂 5L",
      price: 748,
      effectivePriceQuote: {
        effectivePrice: 748,
        conditionRequired: false,
      },
      currency: "JPY",
      shipping: "送料無料候補",
    });
    expect(candidates[0]?.url).toBe("https://search.rakuten.co.jp/item/123");
  });

  it("keeps selected-store and review rewards conditional in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/limited-reward" title="Limited reward detergent">Limited reward detergent</a>
          <span>販売価格 2,000円</span>
          <span>レビュー投稿でポイント 200円相当</span>
          <span>payment method coupon 300 JPY selected sellers only</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Limited reward detergent",
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 200 JPY", "coupon value inferred: 300 JPY"]),
    );
  });

  it("skips unit prices before product totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/unit" title="Unit price detergent">Unit price detergent</a>
          <span>単価 128円 / 100g</span>
          <strong>1,280円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Unit price detergent",
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
      },
    });
  });

  it("skips pack component prices before set totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/case" title="Case water">Case water</a>
          <span>1本 80円 × 12本</span>
          <strong>ケース価格 960円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=water",
    );

    expect(candidates[0]).toMatchObject({
      title: "Case water",
      price: 960,
      effectivePriceQuote: {
        listPrice: 960,
        effectivePrice: 960,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["購入条件あり"]));
  });

  it("skips marketplace sample and trial prices before item totals", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/full-size" title="Full size detergent">Full size detergent</a>
          <span>sample price 300 JPY</span>
          <span>trial size 500 JPY</span>
          <strong>item price 2,400 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Full size detergent",
      price: 2400,
      effectivePriceQuote: {
        listPrice: 2400,
        effectivePrice: 2400,
      },
    });
    expect(candidates.map((candidate) => candidate.price)).not.toEqual(expect.arrayContaining([300, 500]));
  });

  it("filters marketplace sample products before price ranking", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/sample" title="Sample size detergent">Sample size detergent</a>
          <span>price 300 JPY</span>
        </article>
        <article>
          <a href="/item/regular" title="Regular size detergent">Regular size detergent</a>
          <span>price 2,400 JPY</span>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates.map((candidate) => candidate.url)).not.toEqual(expect.arrayContaining(["https://search.rakuten.co.jp/item/sample"]));
    expect(candidates[0]).toMatchObject({
      url: "https://search.rakuten.co.jp/item/regular",
      price: 2400,
    });
  });

  it("skips discount amounts before product totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/discount" title="Discount detergent">Discount detergent</a>
          <span>coupon 300円OFF</span>
          <strong>販売価格 1,280円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Discount detergent",
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        couponValue: 300,
        effectivePrice: 980,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン適用"]));
  });

  it("skips savings amounts before product totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/savings" title="Quantity savings detergent">Quantity savings detergent</a>
          <span>Save 300 JPY when buying 2 or more</span>
          <strong>Current price 1,280 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Quantity savings detergent",
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["購入条件あり"]));
  });

  it("skips tax-excluded prices before tax-included totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/tax" title="Tax included detergent">Tax included detergent</a>
          <span>税抜 1,000円</span>
          <strong>税込 1,100円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Tax included detergent",
      price: 1100,
      effectivePriceQuote: {
        listPrice: 1100,
        effectivePrice: 1100,
      },
    });
  });

  it("skips parenthesized tax-excluded prices before tax-included totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/tax-parenthesized" title="Parenthesized tax included detergent">Parenthesized tax included detergent</a>
          <span>1,000円（税抜）</span>
          <strong>1,100円（税込）</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Parenthesized tax included detergent",
      price: 1100,
      effectivePriceQuote: {
        listPrice: 1100,
        effectivePrice: 1100,
      },
    });
  });

  it("skips colon-separated tax-excluded prices before tax-included totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/tax-colon" title="Colon tax detergent">Colon tax detergent</a>
          <span>税抜価格: 1,000円</span>
          <strong>税込価格: 1,100円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Colon tax detergent",
      price: 1100,
      effectivePriceQuote: {
        listPrice: 1100,
        effectivePrice: 1100,
      },
    });
  });

  it("skips plus-tax prices before tax-included totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/tax-plus" title="Plus tax detergent">Plus tax detergent</a>
          <span>1,000円+税</span>
          <strong>税込 1,100円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Plus tax detergent",
      price: 1100,
      effectivePriceQuote: {
        listPrice: 1100,
        effectivePrice: 1100,
      },
    });
  });

  it("skips English tax-not-included prices before tax-included totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/tax-not-included" title="Tax not included detergent">Tax not included detergent</a>
          <span>1,000 JPY tax not included</span>
          <strong>1,100 JPY tax included</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Tax not included detergent",
      price: 1100,
      effectivePriceQuote: {
        listPrice: 1100,
        effectivePrice: 1100,
      },
    });
  });

  it("skips reference prices before sale totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/sale" title="Sale detergent">Sale detergent</a>
          <span>通常価格 2,000円</span>
          <strong>販売価格 1,500円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Sale detergent",
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        effectivePrice: 1500,
      },
    });
  });

  it("skips colon-separated reference prices before sale totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/sale-colon" title="Colon sale detergent">Colon sale detergent</a>
          <span>通常価格: 2,000円</span>
          <strong>販売価格: 1,500円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Colon sale detergent",
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        effectivePrice: 1500,
      },
    });
  });

  it("skips RRP reference prices before sale totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/rrp-sale" title="RRP sale detergent">RRP sale detergent</a>
          <span>RRP: 2,400 JPY</span>
          <strong>Sale price 1,680 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "RRP sale detergent",
      price: 1680,
      effectivePriceQuote: {
        listPrice: 1680,
        effectivePrice: 1680,
      },
    });
  });

  it("skips expired sale prices before current marketplace item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/current-sale" title="Current sale detergent">Current sale detergent</a>
          <span>タイムセール終了 980円</span>
          <strong>販売価格 1,480円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Current sale detergent",
      price: 1480,
      effectivePriceQuote: {
        listPrice: 1480,
        effectivePrice: 1480,
      },
    });
  });

  it("skips used or open-box prices before new marketplace item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/new-condition" title="New condition detergent">New condition detergent</a>
          <span>open box 980 JPY</span>
          <strong>new item price 1,480 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "New condition detergent",
      price: 1480,
      effectivePriceQuote: {
        listPrice: 1480,
        effectivePrice: 1480,
      },
    });
  });

  it("filters used marketplace HTML snippets before ranking fallback candidates", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/used" title="Detergent refill used open box">Detergent refill used open box</a>
          <span>980円</span>
        </article>
        <article>
          <a href="/new" title="Detergent refill new">Detergent refill new</a>
          <span>1,280円</span>
        </article>
      `,
      "rakuten",
      "https://example.test/search",
    );

    expect(candidates.map((candidate) => candidate.url)).toEqual(["https://example.test/new"]);
  });

  it("skips range lower-bound prices before exact marketplace item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/range" title="Range lower bound detergent">Range lower bound detergent</a>
          <span>from 980円 variant</span>
          <strong>販売価格 1,500円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Range lower bound detergent",
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        effectivePrice: 1500,
      },
    });
  });

  it("skips lowest-price range labels before exact marketplace item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/lowest" title="Lowest range detergent">Lowest range detergent</a>
          <span>Lowest price 980 JPY among variants</span>
          <strong>Current price 1,500 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Lowest range detergent",
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        effectivePrice: 1500,
      },
    });
  });

  it("skips marketplace installment amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/installment" title="Installment detergent">Installment detergent</a>
          <span>月々500円からの分割払い</span>
          <strong>販売価格 1,980円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Installment detergent",
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
    });
  });

  it("skips marketplace per-month financing amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/financing" title="Financing detergent">Financing detergent</a>
          <span>Payment plan 500 JPY per mo.</span>
          <strong>Current price 1,980 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Financing detergent",
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
    });
  });

  it("skips marketplace payment fee amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/fee-copy" title="Fee copy detergent">Fee copy detergent</a>
          <span>決済手数料 250円</span>
          <strong>販売価格 1,980円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Fee copy detergent",
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
    });
  });

  it("skips marketplace cash-on-delivery fee amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/cod-fee" title="COD fee detergent">COD fee detergent</a>
          <span>330 JPY cash on delivery fee</span>
          <strong>item price 1,980 JPY</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "COD fee detergent",
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
    });
    expect(candidates.map((candidate) => candidate.price)).not.toEqual(expect.arrayContaining([330]));
  });

  it("skips marketplace deposit and future-credit amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/future-credit" title="Future credit detergent">Future credit detergent</a>
          <span>デポジット 500円</span>
          <span>gift card 700 JPY for next purchase</span>
          <span>ストアクレジット 300円分</span>
          <strong>販売価格 1,980円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Future credit detergent",
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
    });
  });

  it("skips marketplace warranty and gift-wrap add-on amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/add-on-service" title="Add-on service detergent">Add-on service detergent</a>
          <span>extended warranty 500 JPY</span>
          <span>gift wrap 300 JPY</span>
          <strong>item price 1,980 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Add-on service detergent",
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
    });
    expect(candidates.map((candidate) => candidate.price)).not.toEqual(expect.arrayContaining([300, 500]));
  });

  it("skips marketplace rental, repair, and restocking service amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/service-fee" title="Service fee detergent">Service fee detergent</a>
          <span>rental fee 800 JPY</span>
          <span>repair service 700 JPY</span>
          <span>restocking fee 400 JPY</span>
          <strong>item price 2,480 JPY</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Service fee detergent",
      price: 2480,
      effectivePriceQuote: {
        listPrice: 2480,
        effectivePrice: 2480,
      },
    });
    expect(candidates.map((candidate) => candidate.price)).not.toEqual(expect.arrayContaining([400, 700, 800]));
  });

  it("skips unavailable prices before available totals in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/available" title="Available detergent">Available detergent</a>
          <span>在庫なし 980円</span>
          <strong>販売中 1,280円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Available detergent",
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
      },
    });
  });

  it("skips preorder and restock-pending prices before available marketplace item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/available-preorder" title="Available preorder detergent">Available preorder detergent</a>
          <span>pre-order 980 JPY coming soon</span>
          <span>入荷予定 1,080円</span>
          <strong>販売価格 1,480円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Available preorder detergent",
      price: 1480,
      effectivePriceQuote: {
        listPrice: 1480,
        effectivePrice: 1480,
      },
    });
  });

  it("normalizes marketplace HTML shipping, point, and coupon conditions into effective quotes", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/conditioned" title="Test paper towel 12 rolls">Test paper towel 12 rolls</a>
          <span>price 1,980 JPY</span>
          <span>shipping 300</span>
          <span>points 120</span>
          <span>coupon 200</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=paper",
    );

    expect(candidates[0]).toMatchObject({
      price: 1980,
      shipping: "送料 300円込みで再計算",
      effectivePriceQuote: {
        listPrice: 1980,
        shippingFee: 300,
        pointValue: 120,
        couponValue: 200,
        effectivePrice: 1960,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["shipping fee inferred: 300 JPY", "point value inferred: 120 JPY", "coupon value inferred: 200 JPY"]),
    );
  });

  it("adds Japanese delivery fees to marketplace effective prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/delivery-fee" title="Delivery fee detergent">Delivery fee detergent</a>
          <span>販売価格 1,200円</span>
          <span>配送料 330円</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Delivery fee detergent",
      price: 1200,
      shipping: "送料 330円込みで再計算",
      effectivePriceQuote: {
        listPrice: 1200,
        shippingFee: 330,
        effectivePrice: 1530,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料加算"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["shipping fee inferred: 330 JPY"]));
  });

  it("does not double-count shipping-included copy in marketplace HTML", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/shipping-included" title="Shipping included detergent">Shipping included detergent</a>
          <span>item price 2,400 JPY</span>
          <span>shipping included 300 JPY</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      title: "Shipping included detergent",
      price: 2400,
      effectivePriceQuote: {
        listPrice: 2400,
        shippingFee: 0,
        effectivePrice: 2400,
      },
    });
    expect(candidates[0]?.evidence).not.toEqual(expect.arrayContaining(["shipping fee inferred: 300 JPY"]));
  });

  it("keeps marketplace HTML effective price conservative for ambiguous reward claims", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/ambiguous" title="Ambiguous paper towel">Ambiguous paper towel</a>
          <span>price 1,000 JPY</span>
          <span>shipping 300</span>
          <span>最大 50% points 要エントリー</span>
          <span>coupon up to 900 eligible only</span>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/paper/",
    );

    expect(candidates[0]).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        shippingFee: 300,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 1300,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 500 JPY", "coupon value inferred: 900 JPY"]),
    );
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
  });

  it("skips capped marketplace reward amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/capped-reward" title="Capped reward detergent">Capped reward detergent</a>
          <span>Points capped at 1,000 JPY during campaign</span>
          <span>Coupon savings cap 500 JPY for selected sellers</span>
          <strong>Current price 5,000 JPY</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Capped reward detergent",
      price: 5000,
      effectivePriceQuote: {
        listPrice: 5000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 5000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 1000 JPY", "coupon value inferred: 500 JPY"]),
    );
  });

  it("does not treat marketplace point multipliers as guaranteed yen discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/multiplier" title="Multiplier detergent">Multiplier detergent</a>
          <span>price 1,200 JPY</span>
          <span>points 10x today</span>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      price: 1200,
      effectivePriceQuote: {
        listPrice: 1200,
        pointValue: 0,
        effectivePrice: 1200,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["point condition requires retailer confirmation"]));
    expect(candidates[0]?.evidence).not.toEqual(expect.arrayContaining(["point value inferred: 10 JPY"]));
  });

  it("marks oversized marketplace rewards conditional instead of deducting them", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/oversized-reward" title="Oversized reward detergent">Oversized reward detergent</a>
          <span>price 1,000 JPY</span>
          <span>points 900 JPY</span>
          <span>coupon 900 JPY</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 1000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 900 JPY", "coupon value inferred: 900 JPY"]),
    );
  });

  it("does not deduct marketplace threshold coupons as guaranteed discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/threshold-coupon" title="Threshold coupon detergent">Threshold coupon detergent</a>
          <span>price 1,200 JPY</span>
          <span>coupon 300 JPY when buying 2 or more</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1200,
      effectivePriceQuote: {
        listPrice: 1200,
        couponValue: 0,
        effectivePrice: 1200,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(candidates[0]?.evidence).not.toEqual(expect.arrayContaining(["coupon value inferred: 300 JPY"]));
  });

  it("does not deduct marketplace coupon-code discounts as guaranteed discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/coupon-code" title="Coupon code detergent">Coupon code detergent</a>
          <span>price 1,200 JPY</span>
          <span>coupon code required for 300 JPY off</span>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      price: 1200,
      effectivePriceQuote: {
        listPrice: 1200,
        couponValue: 0,
        effectivePrice: 1200,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(candidates[0]?.evidence).not.toEqual(expect.arrayContaining(["coupon value inferred: 300 JPY"]));
  });

  it("does not use marketplace coupon threshold amounts as item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/japanese-threshold-coupon" title="Japanese threshold coupon detergent">Japanese threshold coupon detergent</a>
          <span>3,000円以上で使える300円クーポン</span>
          <strong>販売価格 1,500円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        couponValue: 0,
        effectivePrice: 1500,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["coupon condition requires retailer confirmation"]));
    expect(candidates[0]?.evidence).not.toEqual(expect.arrayContaining(["coupon value inferred: 300 JPY"]));
  });

  it("does not deduct marketplace login or app-only rewards as guaranteed discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/login-reward" title="Login reward detergent">Login reward detergent</a>
          <span>price 1,500 JPY</span>
          <span>ポイント 120円分 ログイン後に獲得予定</span>
          <span>クーポン 300円 アプリ限定</span>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 1500,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 120 JPY", "coupon value inferred: 300 JPY"]),
    );
  });

  it("does not deduct marketplace reward date strings as guaranteed discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/reward-date" title="Reward date detergent">Reward date detergent</a>
          <span>price 2,000 JPY</span>
          <span>points 120 JPY valid through 2026-06-20</span>
          <span>coupon 300 JPY expires 2026-06-20</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining([
        "point value inferred: 120 JPY",
        "point value inferred: 2026 JPY",
        "coupon value inferred: 300 JPY",
        "coupon value inferred: 2026 JPY",
      ]),
    );
  });

  it("does not use marketplace point reward amounts as item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/reward-before-price" title="Reward before price detergent">Reward before price detergent</a>
          <span>ポイント 120円分 ログイン後に獲得予定</span>
          <strong>販売価格 1,500円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        pointValue: 0,
        effectivePrice: 1500,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["point condition requires retailer confirmation"]));
  });

  it("does not use marketplace effective reward-copy amounts as item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/effective-reward-copy" title="Effective reward copy detergent">Effective reward copy detergent</a>
          <span>実質 980円 ポイント還元後</span>
          <span>ポイント 520円相当</span>
          <strong>販売価格 1,500円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1500,
      effectivePriceQuote: {
        listPrice: 1500,
        pointValue: 520,
        effectivePrice: 980,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント還元込み"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["point value inferred: 520 JPY"]));
  });

  it("does not deduct marketplace delayed points or limited coupons as guaranteed discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/delayed-reward" title="Delayed reward detergent">Delayed reward detergent</a>
          <span>price 2,000 JPY</span>
          <span>PayPayポイント 150円相当 後日付与・付与上限あり</span>
          <span>LINE限定クーポン 300円OFF</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 150 JPY", "coupon value inferred: 300 JPY"]),
    );
  });

  it("does not use marketplace survey or referral rewards as item prices or guaranteed discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/referral-reward" title="Referral reward detergent">Referral reward detergent</a>
          <span>500 JPY referral coupon after inviting a friend</span>
          <span>survey reward points 200 JPY after questionnaire</span>
          <strong>item price 2,400 JPY</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      title: "Referral reward detergent",
      price: 2400,
      effectivePriceQuote: {
        listPrice: 2400,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2400,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates.map((candidate) => candidate.price)).not.toEqual(expect.arrayContaining([200, 500]));
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 200 JPY", "coupon value inferred: 500 JPY"]),
    );
  });

  it("does not deduct marketplace next-purchase rewards as guaranteed discounts", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/next-purchase" title="Next purchase detergent">Next purchase detergent</a>
          <span>price 2,000 JPY</span>
          <span>ポイント 200円分 次回使える</span>
          <span>coupon 300 JPY gift card for next order</span>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      price: 2000,
      effectivePriceQuote: {
        listPrice: 2000,
        pointValue: 0,
        couponValue: 0,
        effectivePrice: 2000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["point condition requires retailer confirmation", "coupon condition requires retailer confirmation"]),
    );
    expect(candidates[0]?.evidence).not.toEqual(
      expect.arrayContaining(["point value inferred: 200 JPY", "coupon value inferred: 300 JPY"]),
    );
  });

  it("marks marketplace subscription and bundle prices as purchase conditions", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/subscription" title="Subscription detergent">Subscription detergent</a>
          <span>subscribe & save first order 1,180 JPY</span>
          <span>bundle set of 3 eligible</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1180,
      effectivePriceQuote: {
        listPrice: 1180,
        effectivePrice: 1180,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["購入条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["purchase condition requires retailer confirmation"]));
  });

  it("skips marketplace installment and fee amounts before item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/installment-fee" title="Installment fee detergent">Installment fee detergent</a>
          <span>monthly 500 JPY installment</span>
          <span>handling fee 330 JPY</span>
          <strong>item price 1,980 JPY</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      price: 1980,
      effectivePriceQuote: {
        listPrice: 1980,
        effectivePrice: 1980,
      },
    });
    expect(candidates.map((candidate) => candidate.price)).not.toEqual(expect.arrayContaining([500, 330]));
  });

  it("keeps marketplace free-shipping thresholds out of effective-price shipping deductions", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/threshold" title="Threshold detergent">Threshold detergent</a>
          <span>price 1,000 JPY</span>
          <span>free shipping on orders over 3,980 JPY</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        shippingFee: 0,
        effectivePrice: 1000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
    expect(candidates[0]?.evidence).not.toEqual(expect.arrayContaining(["shipping fee inferred: 3,980 JPY"]));
  });

  it("does not use marketplace free-shipping threshold amounts as item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/shipping-threshold" title="Shipping threshold detergent">Shipping threshold detergent</a>
          <span>送料無料ライン 3,980円以上</span>
          <strong>販売価格 1,280円</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/detergent/",
    );

    expect(candidates[0]).toMatchObject({
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
  });

  it("does not use marketplace free-shipping remaining amounts as item prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/shipping-progress" title="Shipping progress detergent">Shipping progress detergent</a>
          <span>あと500円で送料無料</span>
          <strong>販売価格 1,280円</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1280,
      effectivePriceQuote: {
        listPrice: 1280,
        effectivePrice: 1280,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
  });

  it("keeps marketplace calculated shipping as retailer-confirmed conditions", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/calculated" title="Calculated shipping detergent">Calculated shipping detergent</a>
          <span>price 1,000 JPY</span>
          <span>shipping not included - calculated at checkout</span>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1000,
      effectivePriceQuote: {
        listPrice: 1000,
        effectivePrice: 1000,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["shipping condition requires retailer confirmation"]));
  });

  it("skips marketplace cart-only prices before regular prices", () => {
    const candidates = extractSearchCandidatesFromHtml(
      `
        <article>
          <a href="/item/cart-price" title="Regular detergent">Regular detergent</a>
          <span>Add to cart to see price 1,080 JPY</span>
          <span>${".".repeat(80)}</span>
          <strong>Item price 1,480 JPY</strong>
        </article>
      `,
      "yahoo-shopping",
      "https://shopping.yahoo.co.jp/search?p=detergent",
    );

    expect(candidates[0]).toMatchObject({
      price: 1480,
      effectivePriceQuote: {
        listPrice: 1480,
        effectivePrice: 1480,
        conditionRequired: true,
      },
    });
    expect(candidates[0]?.effectivePriceQuote?.conditionLabels).toEqual(expect.arrayContaining(["購入条件あり"]));
    expect(candidates[0]?.evidence).toEqual(expect.arrayContaining(["purchase condition requires retailer confirmation"]));
  });

  it("filters unavailable official API machine states before price ranking", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Sold out official detergent",
                  itemPrice: 780,
                  itemUrl: "https://example.com/rakuten-sold-out",
                  availability: 0,
                },
              },
              {
                Item: {
                  itemName: "Available official detergent",
                  itemPrice: 1480,
                  itemUrl: "https://example.com/rakuten-available",
                  availability: 1,
                  postageFlag: 0,
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                name: "Unavailable Yahoo detergent",
                price: 680,
                url: "https://example.com/yahoo-unavailable",
                inStock: false,
              },
              {
                name: "Available Yahoo detergent",
                price: 1280,
                url: "https://example.com/yahoo-available",
                inStock: true,
                shipping: { code: 1, name: "送料無料" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("official detergent");

      expect(result.candidates.map((candidate) => candidate.url)).not.toEqual(
        expect.arrayContaining(["https://example.com/rakuten-sold-out", "https://example.com/yahoo-unavailable"]),
      );
      expect(result.candidates.map((candidate) => candidate.url)).toEqual(
        expect.arrayContaining(["https://example.com/rakuten-available", "https://example.com/yahoo-available"]),
      );
      expect(result.candidates[0]).toMatchObject({
        url: "https://example.com/yahoo-available",
        price: 1280,
      });
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });

  it("does not double-count shipping-included official API shipping fields", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Shipping included Rakuten detergent",
                  itemPrice: 2400,
                  itemUrl: "https://example.com/rakuten-shipping-included",
                  shippingFee: 330,
                  postageLabel: "shipping included in item price",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                name: "Shipping included Yahoo detergent",
                price: 2600,
                url: "https://example.com/yahoo-shipping-included",
                shippingFee: 330,
                shipping: { name: "shipping included in item price" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("shipping included detergent");
      const rakuten = result.candidates.find((candidate) => candidate.url === "https://example.com/rakuten-shipping-included");
      const yahoo = result.candidates.find((candidate) => candidate.url === "https://example.com/yahoo-shipping-included");

      expect(rakuten).toMatchObject({
        price: 2400,
        effectivePriceQuote: {
          listPrice: 2400,
          shippingFee: 0,
          effectivePrice: 2400,
        },
      });
      expect(yahoo).toMatchObject({
        price: 2600,
        effectivePriceQuote: {
          listPrice: 2600,
          shippingFee: 0,
          effectivePrice: 2600,
        },
      });
      expect(rakuten?.evidence).not.toEqual(expect.arrayContaining(["official shipping fee: 330 JPY"]));
      expect(yahoo?.evidence).not.toEqual(expect.arrayContaining(["official shipping fee: 330 JPY"]));
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });

  it("filters official API sample products before price ranking", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Sample size official detergent",
                  itemPrice: 300,
                  itemUrl: "https://example.com/rakuten-sample",
                  postageFlag: 0,
                },
              },
              {
                Item: {
                  itemName: "Regular size official detergent",
                  itemPrice: 2400,
                  itemUrl: "https://example.com/rakuten-regular",
                  postageFlag: 0,
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                name: "Trial size Yahoo detergent",
                price: 500,
                url: "https://example.com/yahoo-trial",
                shipping: { code: 1, name: "free shipping" },
              },
              {
                name: "Regular size Yahoo detergent",
                price: 2200,
                url: "https://example.com/yahoo-regular",
                shipping: { code: 1, name: "free shipping" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("official detergent");

      expect(result.candidates.map((candidate) => candidate.url)).not.toEqual(
        expect.arrayContaining(["https://example.com/rakuten-sample", "https://example.com/yahoo-trial"]),
      );
      expect(result.candidates.map((candidate) => candidate.url)).toEqual(
        expect.arrayContaining(["https://example.com/rakuten-regular", "https://example.com/yahoo-regular"]),
      );
      expect(result.candidates[0]).toMatchObject({
        url: "https://example.com/yahoo-regular",
        price: 2200,
      });
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });

  it("does not deduct official API rewards attached to purchase-condition offers", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Subscribe save official detergent",
                  itemPrice: 2000,
                  itemUrl: "https://example.com/rakuten-subscription-reward",
                  postageFlag: 0,
                  pointRate: 10,
                  couponAmount: 300,
                  description: "Subscribe & Save first order only",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                name: "First order Yahoo detergent",
                price: 2200,
                url: "https://example.com/yahoo-first-order-reward",
                shipping: { code: 1, name: "free shipping" },
                point: { amount: 180 },
                couponAmount: 250,
                offerNote: "first order subscription discount",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("official detergent");
      const rakuten = result.candidates.find((entry) => entry.url === "https://example.com/rakuten-subscription-reward");
      const yahoo = result.candidates.find((entry) => entry.url === "https://example.com/yahoo-first-order-reward");

      expect(rakuten).toMatchObject({
        price: 2000,
        effectivePriceQuote: {
          listPrice: 2000,
          shippingFee: 0,
          pointValue: 0,
          couponValue: 0,
          effectivePrice: 2000,
          conditionRequired: true,
        },
      });
      expect(yahoo).toMatchObject({
        price: 2200,
        effectivePriceQuote: {
          listPrice: 2200,
          shippingFee: 0,
          pointValue: 0,
          couponValue: 0,
          effectivePrice: 2200,
          conditionRequired: true,
        },
      });
      expect(rakuten?.effectivePriceQuote?.conditionLabels).toEqual(
        expect.arrayContaining(["購入条件あり", "ポイント条件あり", "クーポン条件あり"]),
      );
      expect(yahoo?.effectivePriceQuote?.conditionLabels).toEqual(
        expect.arrayContaining(["購入条件あり", "ポイント条件あり", "クーポン条件あり"]),
      );
      expect(rakuten?.evidence).not.toEqual(expect.arrayContaining(["official point value: 200 JPY", "official coupon value: 300 JPY"]));
      expect(yahoo?.evidence).not.toEqual(expect.arrayContaining(["official point value: 180 JPY", "official coupon value: 250 JPY"]));
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });

  it("does not deduct expired official API campaign rewards", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Expired campaign detergent",
                  itemPrice: 2000,
                  itemUrl: "https://example.com/rakuten-expired",
                  postageFlag: 0,
                  pointRate: 10,
                  pointRateEndTime: "2020-01-01T00:00:00+09:00",
                  couponAmount: 300,
                  couponEndTime: "2020-01-01T00:00:00+09:00",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("detergent");
      const candidate = result.candidates.find((entry) => entry.url === "https://example.com/rakuten-expired");

      expect(candidate).toMatchObject({
        price: 2000,
        effectivePriceQuote: {
          listPrice: 2000,
          shippingFee: 0,
          pointValue: 0,
          couponValue: 0,
          effectivePrice: 2000,
          conditionRequired: true,
        },
      });
      expect(candidate?.effectivePriceQuote?.conditionLabels).toEqual(
        expect.arrayContaining(["ポイント期間あり", "ポイント条件あり", "クーポン期間あり", "クーポン条件あり"]),
      );
      expect(candidate?.evidence).toEqual(
        expect.arrayContaining([
          "official point condition requires retailer confirmation",
          "official point window expired before fetch",
          "official coupon condition requires retailer confirmation",
          "official coupon window expired before fetch",
        ]),
      );
      expect(candidate?.evidence).not.toEqual(expect.arrayContaining(["official point value: 200 JPY", "official coupon value: 300 JPY"]));
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });

  it("does not deduct capped official API rewards as guaranteed discounts", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Capped campaign detergent",
                  itemPrice: 3000,
                  itemUrl: "https://example.com/rakuten-capped",
                  postageFlag: 0,
                  point: { amount: 300, note: "maximum point cap during campaign" },
                  couponAmount: 500,
                  couponNote: "coupon savings cap for selected sellers",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("detergent");
      const candidate = result.candidates.find((entry) => entry.url === "https://example.com/rakuten-capped");

      expect(candidate).toMatchObject({
        price: 3000,
        effectivePriceQuote: {
          listPrice: 3000,
          shippingFee: 0,
          pointValue: 0,
          couponValue: 0,
          effectivePrice: 3000,
          conditionRequired: true,
        },
      });
      expect(candidate?.evidence).toEqual(
        expect.arrayContaining([
          "official point condition requires retailer confirmation",
          "official coupon condition requires retailer confirmation",
        ]),
      );
      expect(candidate?.evidence).not.toEqual(expect.arrayContaining(["official point value: 300 JPY", "official coupon value: 500 JPY"]));
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });

  it("does not deduct official API rebate rewards that require a claim", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Official rebate detergent",
                  itemPrice: 2400,
                  itemUrl: "https://example.com/rakuten-rebate",
                  postageFlag: 0,
                  point: { amount: 200, note: "mail-in rebate claim required after checkout" },
                  couponAmount: 300,
                  couponNote: "rebate form after approval",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("detergent");
      const candidate = result.candidates.find((entry) => entry.url === "https://example.com/rakuten-rebate");

      expect(candidate).toMatchObject({
        price: 2400,
        effectivePriceQuote: {
          listPrice: 2400,
          shippingFee: 0,
          pointValue: 0,
          couponValue: 0,
          effectivePrice: 2400,
          conditionRequired: true,
        },
      });
      expect(candidate?.evidence).toEqual(
        expect.arrayContaining([
          "official point condition requires retailer confirmation",
          "official coupon condition requires retailer confirmation",
        ]),
      );
      expect(candidate?.evidence).not.toEqual(expect.arrayContaining(["official point value: 200 JPY", "official coupon value: 300 JPY"]));
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });

  it("does not deduct future official API campaign rewards before they start", async () => {
    const previousRakutenId = process.env.RAKUTEN_APPLICATION_ID;
    const previousYahooId = process.env.YAHOO_SHOPPING_APP_ID;
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Future campaign detergent",
                  itemPrice: 2000,
                  itemUrl: "https://example.com/rakuten-future",
                  postageFlag: 0,
                  pointRate: 10,
                  pointRateStartTime: "2999-01-01T00:00:00+09:00",
                  couponAmount: 300,
                  couponStartTime: "2999-01-01T00:00:00+09:00",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("shopping.yahooapis.jp")) {
        return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const result = await searchProductPrices("detergent");
      const candidate = result.candidates.find((entry) => entry.url === "https://example.com/rakuten-future");

      expect(candidate).toMatchObject({
        price: 2000,
        effectivePriceQuote: {
          listPrice: 2000,
          shippingFee: 0,
          pointValue: 0,
          couponValue: 0,
          effectivePrice: 2000,
          conditionRequired: true,
        },
      });
      expect(candidate?.effectivePriceQuote?.conditionLabels).toEqual(
        expect.arrayContaining(["ポイント期間あり", "ポイント条件あり", "クーポン期間あり", "クーポン条件あり"]),
      );
      expect(candidate?.evidence).toEqual(
        expect.arrayContaining([
          "official point condition requires retailer confirmation",
          "official point window starts after fetch",
          "official coupon condition requires retailer confirmation",
          "official coupon window starts after fetch",
        ]),
      );
      expect(candidate?.evidence).not.toEqual(expect.arrayContaining(["official point value: 200 JPY", "official coupon value: 300 JPY"]));
    } finally {
      if (previousRakutenId === undefined) delete process.env.RAKUTEN_APPLICATION_ID;
      else process.env.RAKUTEN_APPLICATION_ID = previousRakutenId;
      if (previousYahooId === undefined) delete process.env.YAHOO_SHOPPING_APP_ID;
      else process.env.YAHOO_SHOPPING_APP_ID = previousYahooId;
      vi.restoreAllMocks();
    }
  });
});
