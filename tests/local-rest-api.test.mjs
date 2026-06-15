import test from "node:test";
import assert from "node:assert/strict";
import { createLocalRestApi } from "../api/local-rest-api.js";

function createState(overrides = {}) {
  return {
    household: { adults: 2, children: 1, pets: 1, channel: "line", allowSponsored: true, deletePhoto: true },
    autopilot: {
      enabled: false,
      maxAmount: 5000,
      cancelWindowHours: 24,
      brandPolicy: "never",
      deliveryPolicy: "standard",
      requireApprovalForSponsored: true,
    },
    inventory: [],
    metrics: { clicks: 0, sponsoredClicks: 0, approvals: 0, autoReservations: 0, estimatedRevenue: 0 },
    activeFilter: "all",
    queueDecisions: {},
    ...overrides,
  };
}

function createApiHarness(initialState = createState()) {
  let state = initialState;
  let saveCount = 0;
  const api = createLocalRestApi({
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
    },
    saveState: () => {
      saveCount += 1;
    },
    createDefaultState: () => createState(),
    createDetectedItem: () => ({
      name: "食器用洗剤",
      category: "洗濯・掃除",
      stock: 42,
      dailyUsage: 5,
      autoReplenish: false,
      note: "写真候補",
    }),
    offers: [
      { id: "lowest-1", labelType: "lowest", price: 1000, affiliateRate: 0.05 },
      { id: "sponsored-1", labelType: "sponsored", price: 2000, affiliateRate: 0.1 },
    ],
  });

  return {
    api,
    get state() {
      return state;
    },
    get saveCount() {
      return saveCount;
    },
  };
}

test("POST /inventory validates required names", async () => {
  const harness = createApiHarness();
  const response = await harness.api.request("POST", "/inventory", { name: "   " });

  assert.equal(response.ok, false);
  assert.equal(response.status, 422);
  assert.equal(harness.state.inventory.length, 0);
});

test("POST /inventory sanitizes category and clamps numeric fields", async () => {
  const harness = createApiHarness();
  const response = await harness.api.request("POST", "/inventory", {
    name: "洗剤",
    category: "unknown",
    stock: 999,
    dailyUsage: -1,
  });

  assert.equal(response.status, 201);
  assert.equal(harness.state.inventory[0].category, "洗濯・掃除");
  assert.equal(harness.state.inventory[0].stock, 100);
  assert.equal(harness.state.inventory[0].dailyUsage, 1);
  assert.equal(harness.saveCount, 1);
});

test("PATCH and DELETE /inventory update only the addressed item", async () => {
  const harness = createApiHarness(
    createState({
      inventory: [
        { id: "a", name: "A", category: "紙用品", stock: 50, dailyUsage: 5, autoReplenish: false, note: "" },
        { id: "b", name: "B", category: "紙用品", stock: 50, dailyUsage: 5, autoReplenish: false, note: "" },
      ],
      queueDecisions: { a: "pending", b: "pending" },
    }),
  );

  assert.equal((await harness.api.request("PATCH", "/inventory/a", { stockDelta: -100 })).status, 200);
  assert.equal(harness.state.inventory.find((item) => item.id === "a").stock, 5);
  assert.equal(harness.state.inventory.find((item) => item.id === "b").stock, 50);

  assert.equal((await harness.api.request("DELETE", "/inventory/a")).status, 200);
  assert.deepEqual(
    harness.state.inventory.map((item) => item.id),
    ["b"],
  );
  assert.equal(harness.state.queueDecisions.a, undefined);
  assert.equal(harness.state.queueDecisions.b, "pending");
});

test("PUT settings endpoints enforce allow-listed values and numeric bounds", async () => {
  const harness = createApiHarness();

  await harness.api.request("PUT", "/settings/household", {
    adults: 99,
    children: -10,
    pets: 2,
    channel: "sms",
    allowSponsored: true,
    deletePhoto: false,
  });
  assert.deepEqual(harness.state.household, {
    adults: 8,
    children: 0,
    pets: 2,
    channel: "line",
    allowSponsored: true,
    deletePhoto: false,
  });

  await harness.api.request("PUT", "/settings/autopilot", {
    enabled: true,
    maxAmount: 100000,
    cancelWindowHours: 999,
    brandPolicy: "unsafe",
    deliveryPolicy: "teleport",
    requireApprovalForSponsored: false,
  });
  assert.equal(harness.state.autopilot.maxAmount, 50000);
  assert.equal(harness.state.autopilot.cancelWindowHours, 48);
  assert.equal(harness.state.autopilot.brandPolicy, "never");
  assert.equal(harness.state.autopilot.deliveryPolicy, "standard");
});

test("offer clicks and queue actions update metrics through REST resources", async () => {
  const harness = createApiHarness(
    createState({
      inventory: [{ id: "item-1", name: "猫砂", category: "ペット用品", stock: 10, dailyUsage: 5, autoReplenish: true, note: "" }],
    }),
  );

  await harness.api.request("POST", "/offers/sponsored-1/click");
  assert.equal(harness.state.metrics.clicks, 1);
  assert.equal(harness.state.metrics.sponsoredClicks, 1);
  assert.equal(harness.state.metrics.estimatedRevenue, 200);

  await harness.api.request("PATCH", "/queue/item-1", { action: "auto-reserve", estimatedRevenue: 120 });
  assert.equal(harness.state.queueDecisions["item-1"], "auto-reserve");
  assert.equal(harness.state.metrics.approvals, 1);
  assert.equal(harness.state.metrics.autoReservations, 1);
  assert.equal(harness.state.metrics.clicks, 2);
  assert.equal(harness.state.metrics.estimatedRevenue, 320);
});

test("queue actions reject unknown inventory items without mutating metrics", async () => {
  const harness = createApiHarness(
    createState({
      inventory: [{ id: "item-1", name: "A", category: "test", stock: 10, dailyUsage: 5, autoReplenish: true, note: "" }],
    }),
  );

  const response = await harness.api.request("PATCH", "/queue/missing-item", { action: "approve", estimatedRevenue: 120 });

  assert.equal(response.ok, false);
  assert.equal(response.status, 404);
  assert.equal(harness.state.queueDecisions["missing-item"], undefined);
  assert.equal(harness.state.metrics.approvals, 0);
  assert.equal(harness.state.metrics.clicks, 0);
  assert.equal(harness.state.metrics.estimatedRevenue, 0);
  assert.equal(harness.saveCount, 0);
});

test("unknown resources and invalid queue actions return REST-style errors", async () => {
  const harness = createApiHarness(
    createState({
      inventory: [{ id: "item-1", name: "A", category: "test", stock: 10, dailyUsage: 5, autoReplenish: true, note: "" }],
    }),
  );

  const missing = await harness.api.request("GET", "/does-not-exist");
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);

  const invalidAction = await harness.api.request("PATCH", "/queue/item-1", { action: "ship-now" });
  assert.equal(invalidAction.ok, false);
  assert.equal(invalidAction.status, 422);
});

test("POST /state/reset replaces state with the default state", async () => {
  const harness = createApiHarness(createState({ inventory: [{ id: "x", name: "X", category: "紙用品", stock: 5, dailyUsage: 1 }] }));

  assert.equal(harness.state.inventory.length, 1);
  const response = await harness.api.request("POST", "/state/reset");
  assert.equal(response.ok, true);
  assert.equal(harness.state.inventory.length, 0);
});
