import { afterEach, describe, expect, it } from "vitest";
import { buildAccountProfile, normalizeEmail } from "../src/lib/account-profile";
import { createDefaultState } from "../src/lib/demo-state";
import {
  buildNotificationDispatchResults,
  buildNotificationJobs,
  getNotificationProviderReadiness,
  summarizeNotificationDispatchResults,
  summarizeNotificationJobs,
} from "../src/lib/notification-jobs";
import { baseOffers } from "../src/lib/offers";
import {
  buildCandidateConditionAuditLog,
  buildConditionAuditLog,
  buildEffectivePriceQuote,
  buildLivePriceConditionAuditLog,
  buildMarketplaceSearchUrls,
  buildNotificationDrafts,
  buildPriceFetchPlan,
  buildServerSyncPayload,
  buildStaticPriceScanResults,
  buildStaticProductSearchResult,
  isValidJanCode,
  resolveBarcode,
  resolveJanProduct,
} from "../src/lib/post-mvp";
import { buildReplenishmentQueue } from "../src/lib/replenishment";

describe("post-MVP static helpers", () => {
  afterEach(() => {
    delete process.env.HOME_STACK_EMAIL_FROM;
    delete process.env.HOME_STACK_EMAIL_TRANSPORT;
    delete process.env.HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.HOME_STACK_WEB_PUSH_PUBLIC_KEY;
    delete process.env.HOME_STACK_WEB_PUSH_PRIVATE_KEY;
    delete process.env.HOME_STACK_WEB_PUSH_SUBJECT;
  });

  it("builds stable account profiles without exposing raw email addresses", () => {
    const profile = buildAccountProfile({
      email: " USER@example.COM ",
      provider: "email",
      displayName: " Home User ",
      createdAt: "2026-06-15T00:00:00.000Z",
    });

    expect(normalizeEmail(" USER@example.COM ")).toBe("user@example.com");
    expect(profile).toMatchObject({
      authMode: "email-link",
      provider: "email",
      displayName: "Home User",
      verified: false,
      createdAt: "2026-06-15T00:00:00.000Z",
    });
    expect(profile.accountId).toMatch(/^acct-/);
    expect(profile.emailHash).toBeTruthy();
    expect(JSON.stringify(profile)).not.toContain("user@example.com");
  });

  it("validates JAN codes and resolves known demo products", () => {
    expect(isValidJanCode("4900000000016")).toBe(true);
    expect(isValidJanCode("4900000000017")).toBe(false);
    expect(resolveJanProduct("490-0000-000016")).toMatchObject({ name: "猫砂 5L", unitHint: "5L" });
    expect(resolveBarcode("490000000001").corrections).toEqual(["4900000000016"]);
    expect(resolveBarcode("4900000000017")).toMatchObject({
      valid: false,
      corrections: ["4900000000016"],
      product: { name: "猫砂 5L" },
    });
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
    expect(result.candidates.find((candidate) => candidate.source === "demo-catalog")?.effectivePriceQuote).toMatchObject({
      conditionRequired: true,
      effectivePrice: 2260,
    });
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

  it("normalizes effective price with shipping, points, coupons, and condition evidence", () => {
    const quote = buildEffectivePriceQuote({
      listPrice: 2500,
      shippingFee: 300,
      pointValue: 120,
      couponValue: 200,
    });

    expect(quote.effectivePrice).toBe(2480);
    expect(quote.conditionRequired).toBe(true);
    expect(quote.conditionLabels).toEqual(["送料加算", "ポイント還元込み", "クーポン適用"]);
    expect(quote.evidence).toContain("本体価格 2,500円");
  });

  it("builds effective-price condition audit rows sorted by price", () => {
    const auditLog = buildConditionAuditLog(baseOffers.slice(0, 2), "2026-06-15T00:00:00.000Z");

    expect(auditLog.length).toBeGreaterThan(0);
    expect(auditLog[0]?.effectivePrice).toBeLessThanOrEqual(auditLog[1]?.effectivePrice ?? Number.POSITIVE_INFINITY);
    expect(auditLog.some((entry) => entry.conditionCount > 0 && entry.conditionDetails.length > 0)).toBe(true);
    expect(auditLog[0]).toMatchObject({ generatedAt: "2026-06-15T00:00:00.000Z" });
  });

  it("builds candidate audit rows from effective price quotes", () => {
    const result = buildStaticProductSearchResult("4900000000016", baseOffers, "2026-06-15T00:00:00.000Z");
    const auditLog = buildCandidateConditionAuditLog({
      candidates: result.candidates,
      generatedAt: "2026-06-15T00:00:00.000Z",
      sourceQuery: result.normalizedQuery,
    });

    expect(auditLog.length).toBeGreaterThan(0);
    expect(auditLog[0]).toMatchObject({
      generatedAt: "2026-06-15T00:00:00.000Z",
      rankingBasis: "ranked by candidate effectivePriceQuote.effectivePrice with raw price fallback",
    });
    expect(auditLog.some((entry) => entry.evidence.some((evidence) => evidence.startsWith("search query: ")))).toBe(true);
    expect(auditLog.some((entry) => entry.conditionCount > 0 && entry.conditionDetails.length > 0)).toBe(true);
  });

  it("builds live price scan audit rows from effective price quotes", () => {
    const auditLog = buildLivePriceConditionAuditLog({
      generatedAt: "2026-06-15T00:00:00.000Z",
      results: [
        {
          url: "https://example.test/item",
          ok: true,
          title: "Example item",
          price: 2000,
          effectivePriceQuote: buildEffectivePriceQuote({
            listPrice: 2000,
            shippingFee: 300,
            pointValue: 100,
            couponValue: 250,
          }),
          currency: "JPY",
          source: "html-text",
          fetchedAt: "2026-06-15T00:00:00.000Z",
        },
      ],
    });

    expect(auditLog[0]).toMatchObject({
      offerId: "https://example.test/item",
      effectivePrice: 1950,
      conditionCount: 3,
      rankingBasis: "direct product URL scan effectivePriceQuote with raw price fallback",
    });
    expect(auditLog[0]?.evidence).toContain("source: html-text");
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
      accountProfile: buildAccountProfile({
        email: "user@example.test",
        provider: "google",
        createdAt: "2026-06-15T00:00:00.000Z",
      }),
      generatedAt: "2026-06-15T00:00:00.000Z",
    });

    expect(notificationDrafts.every((draft) => draft.channel === state.household.channel)).toBe(true);
    expect(payload).toMatchObject({
      schemaVersion: "post-mvp-sync-v1",
      account: { authMode: "oauth", provider: "google", verified: false },
      summary: {
        inventoryCount: state.inventory.length,
        conditionalAuditCount: auditLog.filter((entry) => entry.conditionCount > 0).length,
      },
    });
  });

  it("prepares notification jobs without sending real notifications", () => {
    const state = createDefaultState();
    const queue = buildReplenishmentQueue(state, baseOffers);
    const notificationDrafts = buildNotificationDrafts(queue, "email", "2026-06-15T00:00:00.000Z");
    const blockedJobs = buildNotificationJobs({
      accountId: "acct-test",
      drafts: notificationDrafts,
      createdAt: "2026-06-15T00:00:00.000Z",
    });
    const queuedJobs = buildNotificationJobs({
      accountId: "acct-test",
      drafts: notificationDrafts,
      contactPoints: { email: "user@example.test" },
      createdAt: "2026-06-15T00:00:00.000Z",
    });

    expect(blockedJobs.every((job) => job.status === "blocked" && job.blockedReason === "missing-destination")).toBe(true);
    expect(queuedJobs.every((job) => job.status === "queued" && job.destination === "user@example.test")).toBe(true);
    expect(summarizeNotificationJobs(queuedJobs)).toMatchObject({ total: queuedJobs.length, queued: queuedJobs.length, blocked: 0 });
  });

  it("builds dry-run notification dispatch results behind the adapter boundary", () => {
    const state = createDefaultState();
    const queue = buildReplenishmentQueue(state, baseOffers);
    const notificationDrafts = buildNotificationDrafts(queue, "email", "2026-06-15T00:00:00.000Z");
    const jobs = buildNotificationJobs({
      accountId: "acct-test",
      drafts: notificationDrafts,
      contactPoints: { email: "user@example.test" },
      createdAt: "2026-06-15T00:00:00.000Z",
    });
    const results = buildNotificationDispatchResults({
      jobs,
      dryRun: true,
      dispatchedAt: "2026-06-15T00:00:01.000Z",
    });

    expect(results.every((result) => result.status === "dry-run" && result.reason === "dry-run-only")).toBe(true);
    expect(results.every((result) => result.provider === "email" && result.attempts === 1)).toBe(true);
    expect(summarizeNotificationDispatchResults(results)).toMatchObject({
      total: results.length,
      dryRun: results.length,
      sent: 0,
      skipped: 0,
    });
  });

  it("reports configured notification providers and non-dry-run dispatch readiness", () => {
    process.env.HOME_STACK_EMAIL_FROM = "noreply@example.test";
    process.env.HOME_STACK_EMAIL_TRANSPORT = "smtp://localhost:1025";
    const state = createDefaultState();
    const queue = buildReplenishmentQueue(state, baseOffers);
    const notificationDrafts = buildNotificationDrafts(queue, "email", "2026-06-15T00:00:00.000Z");
    const jobs = buildNotificationJobs({
      accountId: "acct-test",
      drafts: notificationDrafts,
      contactPoints: { email: "user@example.test" },
      createdAt: "2026-06-15T00:00:00.000Z",
    });
    const readiness = getNotificationProviderReadiness("2026-06-15T00:00:01.000Z");
    const results = buildNotificationDispatchResults({
      jobs,
      dryRun: false,
      dispatchedAt: "2026-06-15T00:00:02.000Z",
      providerReadiness: readiness,
    });

    expect(readiness.providers.email).toMatchObject({ configured: true, configuredBy: "env", mode: "adapter-ready" });
    expect(results.every((result) => result.status === "sent" && result.provider === "email")).toBe(true);
    expect(summarizeNotificationDispatchResults(results)).toMatchObject({ total: results.length, sent: results.length, failed: 0 });
  });
});
