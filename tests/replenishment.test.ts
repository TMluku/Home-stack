import { describe, expect, it } from "vitest";
import { createDefaultState } from "../src/lib/demo-state";
import { recordOutboundClick, recordQueueDecision } from "../src/lib/metrics";
import { baseOffers } from "../src/lib/offers";
import { extractPriceFromHtml } from "../src/lib/price-scraper";
import { extractSearchCandidatesFromHtml } from "../src/lib/product-search";
import {
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
});
