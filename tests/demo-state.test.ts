import { describe, expect, it } from "vitest";
import { createDefaultState, normalizeState } from "../src/lib/demo-state";

describe("normalizeState", () => {
  it("falls back to defaults for missing or invalid persisted state", () => {
    expect(normalizeState(null)).toEqual(createDefaultState());
    expect(normalizeState("bad")).toEqual(createDefaultState());
    expect(normalizeState({ foo: "bar" })).toMatchObject(createDefaultState());
  });

  it("maps legacy active-filter aliases to all", () => {
    const migrated = normalizeState({
      activeFilter: "lowest",
      household: {},
      autopilot: {},
      metrics: {},
    });
    expect(migrated.activeFilter).toBe("all");

    const migratedAgain = normalizeState({
      activeFilter: "sponsored",
      household: {},
      autopilot: {},
      metrics: {},
    });
    expect(migratedAgain.activeFilter).toBe("all");
  });

  it("keeps legacy sponsor flag names while migrating into current conditional fields", () => {
    const migrated = normalizeState({
      household: { allowSponsored: true },
      autopilot: { requireApprovalForSponsored: true },
      metrics: { sponsoredClicks: 7 },
    });

    expect(migrated.household.includeConditionalOffers).toBe(true);
    expect(migrated.autopilot.requireApprovalForConditional).toBe(true);
    expect(migrated.metrics.conditionalClicks).toBe(7);
  });

  it("prioritizes explicit current fields over legacy values", () => {
    const migrated = normalizeState({
      household: { includeConditionalOffers: false, allowSponsored: true },
      autopilot: { requireApprovalForConditional: false, requireApprovalForSponsored: false },
      metrics: { conditionalClicks: 4, sponsoredClicks: 9 },
    });

    expect(migrated.household.includeConditionalOffers).toBe(false);
    expect(migrated.autopilot.requireApprovalForConditional).toBe(false);
    expect(migrated.metrics.conditionalClicks).toBe(4);
  });
});
