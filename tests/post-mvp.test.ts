import { describe, expect, it } from "vitest";
import { createDefaultState } from "../src/lib/demo-state";
import { baseOffers } from "../src/lib/offers";
import {
  buildConditionAuditLog,
  buildMarketplaceSearchUrls,
  buildNotificationDrafts,
  buildPriceFetchPlan,
  buildServerSyncPayload,
  buildStaticPriceScanResults,
  buildStaticProductSearchResult,
  isValidJanCode,
  resolveJanProduct,
} from "../src/lib/post-mvp";
import { buildReplenishmentQueue } from "../src/lib/replenishment";

describe("post-MVP static helpers", () => {
  it("validates JAN codes and resolves known demo products", () => {
    expect(isValidJanCode("4900000000016")).toBe(true);
    expect(isValidJanCode("4900000000017")).toBe(false);
    expect(resolveJanProduct("490-0000-000016")).toMatchObject({ name: "猫砂 5L", unitHint: "5L" });
  });

  it("builds marketplace search links for static GitHub Pages mode", () => {
    const urls = buildMarketplaceSearchUrls("猫砂 5L");

    expect(urls).toHaveLength(3);
    expect(urls[0]?.url).toContain(encodeURIComponent("猫砂 5L"));
  });

  it("returns static candidates from the demo catalog plus external links", () => {
    const result = buildStaticProductSearchResult("4900000000016", baseOffers, "2026-06-15T00:00:00.000Z");

    expect(result.normalizedQuery).toContain("猫砂");
    expect(result.candidates.some((candidate) => candidate.source === "demo-catalog")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.source === "marketplace-link")).toBe(true);
  });

  it("reports static price scan URLs as pending server-side integration", () => {
    const results = buildStaticPriceScanResults("https://example.com/a\nhttps://example.com/b", "2026-06-15T00:00:00.000Z");

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok === false && result.source === "none")).toBe(true);
  });

  it("builds a price fetch plan that prefers official APIs before HTML fallback", () => {
    const plan = buildPriceFetchPlan("猫砂 5L", ["https://example.com/item"]);

    expect(plan.some((step) => step.source === "rakuten-api" && step.extractionPriority[0] === "official-api")).toBe(true);
    expect(plan.some((step) => step.source === "direct-page" && step.extractionPriority.includes("json-ld"))).toBe(true);
    expect(plan.every((step) => step.expectedFields.includes("price"))).toBe(true);
  });

  it("builds effective-price condition audit rows sorted by price", () => {
    const auditLog = buildConditionAuditLog(baseOffers.slice(0, 2), "2026-06-15T00:00:00.000Z");

    expect(auditLog.length).toBeGreaterThan(0);
    expect(auditLog[0]?.effectivePrice).toBeLessThanOrEqual(auditLog[1]?.effectivePrice ?? Number.POSITIVE_INFINITY);
    expect(auditLog.some((entry) => entry.conditionCount > 0 && entry.conditionDetails.length > 0)).toBe(true);
    expect(auditLog[0]).toMatchObject({ generatedAt: "2026-06-15T00:00:00.000Z" });
  });

  it("builds notification drafts and account sync payloads for server persistence", () => {
    const state = createDefaultState();
    const queue = buildReplenishmentQueue(state, baseOffers);
    const auditLog = buildConditionAuditLog(baseOffers, "2026-06-15T00:00:00.000Z");
    const notificationDrafts = buildNotificationDrafts(queue, state.household.channel, "2026-06-15T00:00:00.000Z");
    const payload = buildServerSyncPayload({
      state,
      auditLog,
      notificationDrafts,
      accountId: "acct-test",
      authMode: "email-link",
      generatedAt: "2026-06-15T00:00:00.000Z",
    });

    expect(notificationDrafts.every((draft) => draft.channel === state.household.channel)).toBe(true);
    expect(payload).toMatchObject({
      schemaVersion: "post-mvp-sync-v1",
      account: { accountId: "acct-test", authMode: "email-link" },
      summary: {
        inventoryCount: state.inventory.length,
        conditionalAuditCount: auditLog.filter((entry) => entry.conditionCount > 0).length,
      },
    });
  });
});
