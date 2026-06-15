import { describe, expect, it } from "vitest";
import { createDefaultState } from "../src/lib/demo-state";
import { recordOutboundClick, recordQueueDecision } from "../src/lib/metrics";
import { baseOffers } from "../src/lib/offers";
import { extractPriceFromHtml } from "../src/lib/price-scraper";
import { extractSearchCandidatesFromHtml } from "../src/lib/product-search";
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
});
