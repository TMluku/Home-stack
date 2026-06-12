import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, detectedInventoryCandidates, normalizeState, STORAGE_KEY } from "../data/demo-state.js";
import { baseOffers } from "../data/offers.js";

test("createDefaultState returns isolated copies", () => {
  const first = createDefaultState();
  const second = createDefaultState();

  first.inventory[0].stock = 1;
  first.household.adults = 8;

  assert.notEqual(second.inventory[0].stock, 1);
  assert.notEqual(second.household.adults, 8);
});

test("normalizeState merges saved partial state with current schema defaults", () => {
  const normalized = normalizeState({
    household: { adults: 4 },
    metrics: { clicks: 3 },
    inventory: "not-an-array",
  });

  assert.equal(normalized.household.adults, 4);
  assert.equal(normalized.household.channel, "line");
  assert.equal(normalized.metrics.clicks, 3);
  assert.equal(normalized.metrics.estimatedRevenue, 0);
  assert.equal(Array.isArray(normalized.inventory), true);
});

test("demo data exports stable IDs and candidates for app wiring", () => {
  assert.equal(STORAGE_KEY, "home-stack-state-v4");
  assert.equal(detectedInventoryCandidates.length > 0, true);
  assert.equal(baseOffers.some((offer) => offer.id === "cat-litter-rakuten"), true);
});
