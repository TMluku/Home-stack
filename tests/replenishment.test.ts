import { describe, expect, it, vi } from "vitest";
import { createDefaultState } from "../src/lib/demo-state";
import { recordOutboundClick, recordQueueDecision } from "../src/lib/metrics";
import { baseOffers } from "../src/lib/offers";
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
