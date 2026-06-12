import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReplenishmentQueue,
  calculateDaysLeft,
  canAutoReserve,
  getRecommendedOffers,
  getUrgency,
  getUrgentInventory,
} from "../core/replenishment.js";

const baseState = {
  household: { adults: 2, children: 1, pets: 1, allowSponsored: true },
  autopilot: { enabled: false, maxAmount: 5000, brandPolicy: "never", requireApprovalForSponsored: true },
  inventory: [],
  activeFilter: "all",
  queueDecisions: {},
};

const offers = [
  { id: "pet-low", category: "ペット用品", labelType: "lowest", price: 1200, affiliateRate: 0.05 },
  { id: "pet-ad", category: "ペット用品", labelType: "sponsored", price: 900, affiliateRate: 0.1 },
  { id: "baby-ad", category: "ベビー用品", labelType: "sponsored", price: 1500, affiliateRate: 0.1 },
  { id: "paper-low", category: "紙用品", labelType: "lowest", price: 700, affiliateRate: 0.03 },
];

test("calculateDaysLeft adjusts usage by household and pets", () => {
  const item = { category: "ペット用品", stock: 24, dailyUsage: 4 };
  assert.equal(calculateDaysLeft(item, baseState.household), 5);
});

test("getUrgency maps days left to stable UI states", () => {
  assert.equal(getUrgency(5), "danger");
  assert.equal(getUrgency(10), "warning");
  assert.equal(getUrgency(11), "safe");
});

test("getUrgentInventory returns only items at or below the replenishment threshold", () => {
  const state = {
    ...baseState,
    inventory: [
      { id: "soon", category: "紙用品", stock: 20, dailyUsage: 5 },
      { id: "later", category: "紙用品", stock: 100, dailyUsage: 2 },
    ],
  };
  assert.deepEqual(
    getUrgentInventory(state).map((item) => item.id),
    ["soon"],
  );
});

test("getRecommendedOffers respects household, sponsorship, and active filters", () => {
  const state = {
    ...baseState,
    household: { ...baseState.household, pets: 1, children: 0, allowSponsored: false },
    inventory: [{ id: "pet", category: "ペット用品", stock: 10, dailyUsage: 5 }],
    activeFilter: "all",
  };

  assert.deepEqual(
    getRecommendedOffers(state, offers).map((offer) => offer.id),
    ["pet-low"],
  );
});

test("canAutoReserve blocks sponsored substitutions when approval is required", () => {
  const item = { autoReplenish: true };
  const offer = { labelType: "sponsored", price: 900 };
  assert.equal(
    canAutoReserve(item, offer, { enabled: true, maxAmount: 1000, brandPolicy: "never", requireApprovalForSponsored: true }),
    false,
  );
  assert.equal(
    canAutoReserve(item, { labelType: "lowest", price: 900 }, { enabled: true, maxAmount: 1000, brandPolicy: "never", requireApprovalForSponsored: true }),
    true,
  );
});

test("buildReplenishmentQueue chooses the cheapest eligible offer and carries decision state", () => {
  const state = {
    ...baseState,
    autopilot: { enabled: true, maxAmount: 1000, brandPolicy: "allow-same-spec", requireApprovalForSponsored: false },
    inventory: [{ id: "pet", category: "ペット用品", stock: 10, dailyUsage: 5, autoReplenish: true }],
    queueDecisions: { pet: "pending" },
  };
  const [entry] = buildReplenishmentQueue(state, offers);

  assert.equal(entry.offer.id, "pet-ad");
  assert.equal(entry.autoReservable, true);
  assert.equal(entry.estimatedRevenue, 90);
});
