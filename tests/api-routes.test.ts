import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as resolveAccount } from "../src/app/api/account/resolve/route";
import { POST as appendCandidateAudit } from "../src/app/api/audit/candidates/append/route";
import { POST as appendConditionAudit } from "../src/app/api/audit/conditions/append/route";
import { POST as listConditionAudit } from "../src/app/api/audit/conditions/list/route";
import { POST as resolveBarcode } from "../src/app/api/barcode/resolve/route";
import { POST as getBarcodeStatus } from "../src/app/api/barcode/status/route";
import { POST as dispatchNotifications } from "../src/app/api/notifications/dispatch/route";
import { POST as prepareNotifications } from "../src/app/api/notifications/prepare/route";
import { POST as scanPrices } from "../src/app/api/price-scan/route";
import { POST as searchProducts } from "../src/app/api/product-search/route";
import { POST as exportState } from "../src/app/api/state/export/route";
import { POST as loadState } from "../src/app/api/state/load/route";
import { POST as resetState } from "../src/app/api/state/reset/route";
import { POST as saveState } from "../src/app/api/state/save/route";
import { POST as getStateStatus } from "../src/app/api/state/status/route";

describe("API route contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HOME_STACK_STATE_STORE_DIR;
    delete process.env.HOME_STACK_BARCODE_MASTER_URL;
  });

  it("rejects empty price scan requests", async () => {
    const response = await scanPrices(
      new Request("http://localhost/api/price-scan", {
        method: "POST",
        body: JSON.stringify({ urls: [] }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ ok: false, results: [] });
    expect(payload.error).toContain("URL");
  });

  it("limits price scan requests to five URLs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <html>
            <head><title>API fixture</title></head>
            <body><span>価格 1,280円</span></body>
          </html>
        `,
        { status: 200 },
      ),
    );

    const response = await scanPrices(
      new Request("http://localhost/api/price-scan", {
        method: "POST",
        body: JSON.stringify({
          urls: [
            "https://example.com/a",
            "https://example.com/b",
            "https://example.com/c",
            "https://example.com/d",
            "https://example.com/e",
            "https://example.com/f",
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.results).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("rejects empty product search requests", async () => {
    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "  " }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
  });

  it("resolves barcodes and returns correction-aware search candidates", async () => {
    const response = await resolveBarcode(
      new Request("http://localhost/api/barcode/resolve", {
        method: "POST",
        body: JSON.stringify({ barcode: "4900000000017" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resolution).toMatchObject({
      valid: false,
      corrections: ["4900000000016"],
      product: { name: "猫砂 5L" },
    });
    expect(payload.master).toMatchObject({
      provider: { kind: "demo-catalog", configuredBy: "default" },
      source: "demo-catalog",
      matched: true,
    });
    expect(payload.searchResult.candidates.length).toBeGreaterThan(0);
  });

  it("reports barcode master provider status", async () => {
    process.env.HOME_STACK_BARCODE_MASTER_URL = "https://master.example.test/lookup";

    const response = await getBarcodeStatus();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: {
        kind: "external-http",
        configuredBy: "env",
        endpoint: "https://master.example.test/lookup",
        ready: true,
      },
    });
  });

  it("resolves valid barcodes from an external JAN master when configured", async () => {
    process.env.HOME_STACK_BARCODE_MASTER_URL = "https://master.example.test/lookup";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          product: {
            janCode: "4900000000047",
            name: "External sponge pack",
            category: "Kitchen",
            unitHint: "5 pcs",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await resolveBarcode(
      new Request("http://localhost/api/barcode/resolve", {
        method: "POST",
        body: JSON.stringify({ barcode: "4900000000047" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://master.example.test/lookup?janCode=4900000000047",
      expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
    );
    expect(payload.resolution).toMatchObject({
      valid: true,
      product: { name: "External sponge pack", category: "Kitchen", unitHint: "5 pcs" },
    });
    expect(payload.master).toMatchObject({
      provider: { kind: "external-http", configuredBy: "env" },
      source: "external-http",
      matched: true,
      evidence: ["matched external JAN master"],
    });
  });

  it("exports the default sync payload for server persistence", async () => {
    const response = await exportState(
      new Request("http://localhost/api/state/export", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.payload).toMatchObject({
      schemaVersion: "post-mvp-sync-v1",
      account: { accountId: "demo-account", authMode: "demo" },
    });
    expect(payload.payload.auditLog.length).toBeGreaterThan(0);
  });

  it("exports posted state with account metadata", async () => {
    const response = await exportState(
      new Request("http://localhost/api/state/export", {
        method: "POST",
        body: JSON.stringify({
          accountId: "acct-123",
          authMode: "oauth",
          state: {
            household: { channel: "email" },
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.payload.account).toEqual({ accountId: "acct-123", authMode: "oauth" });
    expect(payload.payload.state.household.channel).toBe("email");
  });

  it("resolves email-link accounts and includes profile metadata in exported state", async () => {
    const accountResponse = await resolveAccount(
      new Request("http://localhost/api/account/resolve", {
        method: "POST",
        body: JSON.stringify({ email: " USER@example.TEST ", displayName: "Home User" }),
      }),
    );
    const account = await accountResponse.json();

    expect(accountResponse.status).toBe(200);
    expect(account.profile).toMatchObject({
      authMode: "email-link",
      provider: "email",
      displayName: "Home User",
      verified: false,
    });
    expect(JSON.stringify(account.profile)).not.toContain("USER@example.TEST");

    const exportResponse = await exportState(
      new Request("http://localhost/api/state/export", {
        method: "POST",
        body: JSON.stringify({ email: " USER@example.TEST ", displayName: "Home User" }),
      }),
    );
    const exported = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exported.payload.account).toMatchObject({
      accountId: account.profile.accountId,
      authMode: "email-link",
      emailHash: account.profile.emailHash,
      displayName: "Home User",
    });
  });

  it("saves, loads, and resets account state on the server", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-state-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;

    try {
      const exportResponse = await exportState(
        new Request("http://localhost/api/state/export", {
          method: "POST",
          body: JSON.stringify({
            accountId: "acct/server test",
            authMode: "email-link",
          }),
        }),
      );
      const exported = await exportResponse.json();

      const saveResponse = await saveState(
        new Request("http://localhost/api/state/save", {
          method: "POST",
          body: JSON.stringify({ payload: exported.payload }),
        }),
      );
      const saved = await saveResponse.json();

      expect(saveResponse.status).toBe(200);
      expect(saved.stored.accountId).toBe("acct-server-test");

      const loadResponse = await loadState(
        new Request("http://localhost/api/state/load", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct/server test" }),
        }),
      );
      const loaded = await loadResponse.json();

      expect(loadResponse.status).toBe(200);
      expect(loaded.stored.payload.auditLog.length).toBeGreaterThan(0);
      expect(loaded.stored.payload.notificationDrafts).toEqual(saved.stored.payload.notificationDrafts);

      const resetResponse = await resetState(
        new Request("http://localhost/api/state/reset", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct/server test" }),
        }),
      );
      expect(resetResponse.status).toBe(200);

      const missingResponse = await loadState(
        new Request("http://localhost/api/state/load", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct/server test" }),
        }),
      );
      expect(missingResponse.status).toBe(404);
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("reports the configured server state repository status", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-state-status-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;

    try {
      const response = await getStateStatus(
        new Request("http://localhost/api/state/status", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct/status test" }),
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        ok: true,
        account: { accountId: "acct-status-test" },
        status: {
          kind: "file-json",
          configuredBy: "env",
          writable: true,
          schemaVersion: "post-mvp-sync-v1",
          supports: {
            accountState: true,
            auditEvents: true,
            replaceableRepository: true,
          },
        },
      });
      expect(payload.status.storeDir).toBe(storeDir);
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("appends and lists condition audit events for an account", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-audit-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;

    try {
      const exportResponse = await exportState(
        new Request("http://localhost/api/state/export", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-audit" }),
        }),
      );
      const exported = await exportResponse.json();

      const appendResponse = await appendConditionAudit(
        new Request("http://localhost/api/audit/conditions/append", {
          method: "POST",
          body: JSON.stringify({
            payload: exported.payload,
            eventType: "condition-price-ranked",
          }),
        }),
      );
      const appended = await appendResponse.json();

      expect(appendResponse.status).toBe(200);
      expect(appended.appended.length).toBe(exported.payload.auditLog.length);
      expect(appended.appended[0]).toMatchObject({ accountId: "acct-audit", eventType: "condition-price-ranked" });

      const listResponse = await listConditionAudit(
        new Request("http://localhost/api/audit/conditions/list", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-audit" }),
        }),
      );
      const listed = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listed.events.length).toBe(appended.appended.length);
      expect(listed.events.some((event: { conditionCount: number }) => event.conditionCount > 0)).toBe(true);

      await resetState(
        new Request("http://localhost/api/state/reset", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-audit" }),
        }),
      );
      const afterResetResponse = await listConditionAudit(
        new Request("http://localhost/api/audit/conditions/list", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-audit" }),
        }),
      );
      const afterReset = await afterResetResponse.json();
      expect(afterReset.events).toEqual([]);
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("appends search candidate price audit events for an account", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-candidate-audit-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;

    try {
      const searchResponse = await resolveBarcode(
        new Request("http://localhost/api/barcode/resolve", {
          method: "POST",
          body: JSON.stringify({ barcode: "4900000000016" }),
        }),
      );
      const searched = await searchResponse.json();

      const appendResponse = await appendCandidateAudit(
        new Request("http://localhost/api/audit/candidates/append", {
          method: "POST",
          body: JSON.stringify({
            accountId: "acct-candidate-audit",
            searchResult: searched.searchResult,
            generatedAt: "2026-06-15T00:00:00.000Z",
          }),
        }),
      );
      const appended = await appendResponse.json();

      expect(appendResponse.status).toBe(200);
      expect(appended.appended.length).toBeGreaterThan(0);
      expect(appended.appended[0]).toMatchObject({
        accountId: "acct-candidate-audit",
        eventType: "condition-price-ranked",
        generatedAt: "2026-06-15T00:00:00.000Z",
      });
      expect(appended.appended.some((event: { rankingBasis: string }) => event.rankingBasis.includes("effectivePriceQuote"))).toBe(true);

      const listResponse = await listConditionAudit(
        new Request("http://localhost/api/audit/conditions/list", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-candidate-audit" }),
        }),
      );
      const listed = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listed.events.length).toBe(appended.appended.length);
      expect(
        listed.events.some((event: { evidence: string[] }) => event.evidence.some((evidence) => evidence.startsWith("search query: "))),
      ).toBe(true);
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("prepares notification jobs from a sync payload without delivering them", async () => {
    const exportResponse = await exportState(
      new Request("http://localhost/api/state/export", {
        method: "POST",
        body: JSON.stringify({
          accountId: "acct-notify",
          state: {
            household: { channel: "email" },
          },
        }),
      }),
    );
    const exported = await exportResponse.json();

    const blockedResponse = await prepareNotifications(
      new Request("http://localhost/api/notifications/prepare", {
        method: "POST",
        body: JSON.stringify({ payload: exported.payload }),
      }),
    );
    const blocked = await blockedResponse.json();

    expect(blockedResponse.status).toBe(200);
    expect(blocked.summary.blocked).toBe(blocked.summary.total);

    const queuedResponse = await prepareNotifications(
      new Request("http://localhost/api/notifications/prepare", {
        method: "POST",
        body: JSON.stringify({
          payload: exported.payload,
          contactPoints: { email: "user@example.test" },
        }),
      }),
    );
    const queued = await queuedResponse.json();

    expect(queuedResponse.status).toBe(200);
    expect(queued.summary.queued).toBe(queued.summary.total);
    expect(queued.jobs[0].payload.message).toContain("実質価格");
  });

  it("dry-runs notification dispatch results through the adapter boundary", async () => {
    const exportResponse = await exportState(
      new Request("http://localhost/api/state/export", {
        method: "POST",
        body: JSON.stringify({
          accountId: "acct-dispatch",
          state: {
            household: { channel: "email" },
          },
        }),
      }),
    );
    const exported = await exportResponse.json();

    const dryRunResponse = await dispatchNotifications(
      new Request("http://localhost/api/notifications/dispatch", {
        method: "POST",
        body: JSON.stringify({
          payload: exported.payload,
          contactPoints: { email: "user@example.test" },
          dispatchedAt: "2026-06-15T00:00:01.000Z",
        }),
      }),
    );
    const dryRun = await dryRunResponse.json();

    expect(dryRunResponse.status).toBe(200);
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.summary.dryRun).toBe(dryRun.summary.total);
    expect(dryRun.results[0]).toMatchObject({
      accountId: "acct-dispatch",
      provider: "email",
      status: "dry-run",
      reason: "dry-run-only",
      dispatchedAt: "2026-06-15T00:00:01.000Z",
    });

    const blockedResponse = await dispatchNotifications(
      new Request("http://localhost/api/notifications/dispatch", {
        method: "POST",
        body: JSON.stringify({
          payload: exported.payload,
        }),
      }),
    );
    const blocked = await blockedResponse.json();

    expect(blockedResponse.status).toBe(200);
    expect(blocked.summary.skipped).toBe(blocked.summary.total);
    expect(blocked.results[0].reason).toBe("missing-destination");
  });
});
