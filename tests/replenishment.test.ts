import { describe, expect, it } from "vitest";
import { createDefaultState } from "../src/lib/demo-state";
import { baseOffers } from "../src/lib/offers";
import { extractPriceFromHtml } from "../src/lib/price-scraper";
import { extractSearchCandidatesFromHtml } from "../src/lib/product-search";
import { buildReplenishmentQueue, calculateDaysLeft, getRecommendedOffers, getUrgency } from "../src/lib/replenishment";
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

  it("filters sponsored offers when household rules disallow them", () => {
    const state = createDefaultState();
    state.household.allowSponsored = false;
    state.activeFilter = "all";

    expect(getRecommendedOffers(state, baseOffers).every((offer) => offer.labelType === "lowest")).toBe(true);
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

  it("allows auto-reserve only when autopilot, item, amount, and ad policy permit it", () => {
    const state: AppState = createDefaultState();
    state.autopilot.enabled = true;
    state.autopilot.maxAmount = 3000;
    state.autopilot.brandPolicy = "allow-same-spec";
    state.autopilot.requireApprovalForSponsored = false;
    state.inventory = state.inventory.map((item) => (item.id === "cat-litter" ? { ...item, autoReplenish: true } : item));

    const catEntry = buildReplenishmentQueue(state, baseOffers).find((entry) => entry.item.id === "cat-litter");

    expect(catEntry?.autoReservable).toBe(true);
  });

  it("marks offer prices as demo data with comparison evidence", () => {
    expect(baseOffers.every((offer) => offer.priceMode === "demo")).toBe(true);
    expect(baseOffers.every((offer) => offer.competitors.length >= 2)).toBe(true);
    expect(baseOffers.every((offer) => offer.comparisonBasis.length > 0)).toBe(true);
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
          <a href="/item/123" title="ライオン ニオイをとる砂 5L">ライオン ニオイをとる砂 5L</a>
          <span>送料無料</span>
          <strong>¥748</strong>
        </article>
      `,
      "rakuten",
      "https://search.rakuten.co.jp/search/mall/cat-litter/",
    );

    expect(candidates[0]).toMatchObject({
      source: "rakuten",
      title: "ライオン ニオイをとる砂 5L",
      price: 748,
      currency: "JPY",
      shipping: "送料無料候補",
    });
    expect(candidates[0]?.url).toBe("https://search.rakuten.co.jp/item/123");
  });
});
