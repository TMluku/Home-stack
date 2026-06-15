import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import webPush from "web-push";
import { POST as listAccounts } from "../src/app/api/account/list/route";
import { POST as resolveAccount } from "../src/app/api/account/resolve/route";
import { POST as appendCandidateAudit } from "../src/app/api/audit/candidates/append/route";
import { POST as appendConditionAudit } from "../src/app/api/audit/conditions/append/route";
import { POST as listConditionAudit } from "../src/app/api/audit/conditions/list/route";
import { POST as appendPriceScanAudit } from "../src/app/api/audit/price-scans/append/route";
import { POST as resolveBarcode } from "../src/app/api/barcode/resolve/route";
import { POST as getBarcodeStatus } from "../src/app/api/barcode/status/route";
import { POST as dispatchNotifications } from "../src/app/api/notifications/dispatch/route";
import { POST as listNotificationHistory } from "../src/app/api/notifications/history/route";
import { POST as prepareNotifications } from "../src/app/api/notifications/prepare/route";
import { POST as getNotificationStatus } from "../src/app/api/notifications/status/route";
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
    delete process.env.HOME_STACK_STATE_STORE_KIND;
    delete process.env.HOME_STACK_STATE_TABLE_PREFIX;
    delete process.env.HOME_STACK_POSTGRES_URL;
    delete process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED;
    delete process.env.HOME_STACK_TRUSTED_ACCOUNT_HEADER;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    delete process.env.HOME_STACK_BARCODE_MASTER_URL;
    delete process.env.HOME_STACK_EMAIL_FROM;
    delete process.env.HOME_STACK_EMAIL_TRANSPORT;
    delete process.env.HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.HOME_STACK_WEB_PUSH_PUBLIC_KEY;
    delete process.env.HOME_STACK_WEB_PUSH_PRIVATE_KEY;
    delete process.env.HOME_STACK_WEB_PUSH_SUBJECT;
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
    expect(payload.results[0].effectivePriceQuote).toMatchObject({
      listPrice: 1280,
      effectivePrice: 1280,
    });
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
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get("janCode")).toBe("4900000000047");
    expect(requestedUrl.searchParams.get("barcode")).toBe("4900000000047");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
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
      evidence: ["matched external JAN master", "normalized external JAN master payload"],
    });
    expect(payload.searchResult.normalizedQuery).toBe("External sponge pack");
  });

  it("normalizes nested external JAN master response variants", async () => {
    process.env.HOME_STACK_BARCODE_MASTER_URL = "https://master.example.test/lookup";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            results: [
              {
                item: {
                  jan_code: "4900000000054",
                  product_name: "Nested detergent refill",
                  category_name: "Laundry",
                  capacity: "1.8L",
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await resolveBarcode(
      new Request("http://localhost/api/barcode/resolve", {
        method: "POST",
        body: JSON.stringify({ janCode: "4900000000054" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.resolution.product).toMatchObject({
      janCode: "4900000000054",
      name: "Nested detergent refill",
      category: "Laundry",
      unitHint: "1.8L",
    });
    expect(payload.master).toMatchObject({ source: "external-http", matched: true });
    expect(payload.searchResult.normalizedQuery).toBe("Nested detergent refill");
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

      const listResponse = await listAccounts(new Request("http://localhost/api/account/list", { method: "POST" }));
      const listed = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listed.accounts).toContainEqual(
        expect.objectContaining({
          accountId: "acct-server-test",
          authMode: "email-link",
          schemaVersion: "post-mvp-sync-v1",
          inventoryCount: saved.stored.payload.summary.inventoryCount,
          notificationDraftCount: saved.stored.payload.summary.notificationDraftCount,
        }),
      );

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

      const emptyListResponse = await listAccounts(new Request("http://localhost/api/account/list", { method: "POST" }));
      const emptyList = await emptyListResponse.json();

      expect(emptyList.accounts).not.toContainEqual(expect.objectContaining({ accountId: "acct-server-test" }));

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

  it("enforces account-scoped API access when trusted account headers are required", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-auth-state-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;
    process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED = "true";

    try {
      const exportResponse = await exportState(
        new Request("http://localhost/api/state/export", {
          method: "POST",
          body: JSON.stringify({
            accountId: "acct-auth",
            authMode: "email-link",
          }),
        }),
      );
      const exported = await exportResponse.json();

      const missingHeaderResponse = await saveState(
        new Request("http://localhost/api/state/save", {
          method: "POST",
          body: JSON.stringify({ payload: exported.payload }),
        }),
      );
      const missingHeader = await missingHeaderResponse.json();

      expect(missingHeaderResponse.status).toBe(401);
      expect(missingHeader).toMatchObject({
        ok: false,
        context: { required: true, source: "missing" },
        stored: null,
      });

      const saveResponse = await saveState(
        new Request("http://localhost/api/state/save", {
          method: "POST",
          headers: { "x-home-stack-account-id": "acct-auth" },
          body: JSON.stringify({ payload: exported.payload }),
        }),
      );
      expect(saveResponse.status).toBe(200);

      const forbiddenLoadResponse = await loadState(
        new Request("http://localhost/api/state/load", {
          method: "POST",
          headers: { "x-home-stack-account-id": "acct-other" },
          body: JSON.stringify({ accountId: "acct-auth" }),
        }),
      );
      const forbiddenLoad = await forbiddenLoadResponse.json();

      expect(forbiddenLoadResponse.status).toBe(403);
      expect(forbiddenLoad).toMatchObject({
        ok: false,
        context: { accountId: "acct-other", required: true, source: "trusted-header" },
        stored: null,
      });

      const listResponse = await listAccounts(
        new Request("http://localhost/api/account/list", {
          method: "POST",
          headers: { "x-home-stack-account-id": "acct-auth" },
        }),
      );
      const listed = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listed.accounts).toHaveLength(1);
      expect(listed.accounts[0]).toMatchObject({ accountId: "acct-auth" });
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

  it("reports postgres repository status without leaking database URLs", async () => {
    process.env.HOME_STACK_STATE_STORE_KIND = "postgres";
    process.env.HOME_STACK_STATE_TABLE_PREFIX = "home-stack test";

    const response = await getStateStatus(
      new Request("http://localhost/api/state/status", {
        method: "POST",
        body: JSON.stringify({ accountId: "acct/postgres status" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      account: { accountId: "acct-postgres-status" },
      status: {
        kind: "postgres",
        configuredBy: "env",
        databaseUrlConfigured: false,
        tablePrefix: "home_stack_test",
        writable: false,
      },
    });
    expect(JSON.stringify(payload.status)).not.toContain("postgres://");
    expect(payload.status.error).toContain("POSTGRES_URL");
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

  it("appends direct price scan audit events for an account", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-price-scan-audit-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;

    try {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          `
            <html>
              <head><title>Audited direct item</title></head>
              <body>
                <span>price 2,000 JPY</span>
                <span>shipping 300</span>
                <span>points 100</span>
                <span>coupon 250</span>
              </body>
            </html>
          `,
          { status: 200 },
        ),
      );

      const scanResponse = await scanPrices(
        new Request("http://localhost/api/price-scan", {
          method: "POST",
          body: JSON.stringify({ urls: ["https://example.test/direct-item"] }),
        }),
      );
      const scanned = await scanResponse.json();

      const appendResponse = await appendPriceScanAudit(
        new Request("http://localhost/api/audit/price-scans/append", {
          method: "POST",
          body: JSON.stringify({
            accountId: "acct-price-scan-audit",
            results: scanned.results,
            generatedAt: "2026-06-15T00:00:00.000Z",
          }),
        }),
      );
      const appended = await appendResponse.json();

      expect(scanResponse.status).toBe(200);
      expect(appendResponse.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(appended.appended[0]).toMatchObject({
        accountId: "acct-price-scan-audit",
        eventType: "condition-price-ranked",
        offerId: "https://example.test/direct-item",
        effectivePrice: 1950,
        conditionCount: 3,
      });

      const listResponse = await listConditionAudit(
        new Request("http://localhost/api/audit/conditions/list", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-price-scan-audit" }),
        }),
      );
      const listed = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(listed.events[0].rankingBasis).toContain("direct product URL scan");
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("prepares notification jobs from a sync payload without delivering them", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-notify-prepare-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;

    try {
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
      expect(queued.event).toMatchObject({ accountId: "acct-notify", eventType: "notification-prepared" });
      const historyResponse = await listNotificationHistory(
        new Request("http://localhost/api/notifications/history", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-notify" }),
        }),
      );
      const history = await historyResponse.json();

      expect(historyResponse.status).toBe(200);
      expect(history.events[0]).toMatchObject({ eventType: "notification-prepared", summary: { queued: queued.summary.total } });
      expect(queued.readiness.providers.email).toMatchObject({ configured: false, mode: "dry-run-only" });
      expect(queued.jobs[0].payload.message).toContain("実質価格");
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("reports notification provider readiness from environment configuration", async () => {
    process.env.HOME_STACK_EMAIL_FROM = "noreply@example.test";
    process.env.HOME_STACK_EMAIL_TRANSPORT = "smtp://localhost:1025";

    const response = await getNotificationStatus();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.readiness.providers.email).toMatchObject({
      provider: "email",
      configured: true,
      configuredBy: "env",
      mode: "adapter-ready",
    });
    expect(payload.readiness.providers.line).toMatchObject({ configured: false, configuredBy: "missing" });
  });

  it("dry-runs notification dispatch results through the adapter boundary", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-notify-dispatch-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;

    try {
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
      expect(dryRun.event).toMatchObject({ accountId: "acct-dispatch", eventType: "notification-dispatched", dryRun: true });

      const historyResponse = await listNotificationHistory(
        new Request("http://localhost/api/notifications/history", {
          method: "POST",
          body: JSON.stringify({ accountId: "acct-dispatch" }),
        }),
      );
      const history = await historyResponse.json();

      expect(historyResponse.status).toBe(200);
      expect(history.events[0]).toMatchObject({ eventType: "notification-dispatched", summary: { dryRun: dryRun.summary.total } });

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

      const liveAttemptResponse = await dispatchNotifications(
        new Request("http://localhost/api/notifications/dispatch", {
          method: "POST",
          body: JSON.stringify({
            payload: exported.payload,
            contactPoints: { email: "user@example.test" },
            dryRun: false,
          }),
        }),
      );
      const liveAttempt = await liveAttemptResponse.json();

      expect(liveAttemptResponse.status).toBe(200);
      expect(liveAttempt.dryRun).toBe(false);
      expect(liveAttempt.results[0]).toMatchObject({
        provider: "email",
        status: "failed",
        reason: "provider-not-configured",
      });

      process.env.HOME_STACK_EMAIL_FROM = "noreply@example.test";
      process.env.HOME_STACK_EMAIL_TRANSPORT = "smtp://localhost:1025";
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: "email-message-1" });
      const createTransportMock = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail: sendMailMock } as never);
      const configuredResponse = await dispatchNotifications(
        new Request("http://localhost/api/notifications/dispatch", {
          method: "POST",
          body: JSON.stringify({
            payload: exported.payload,
            contactPoints: { email: "user@example.test" },
            dryRun: false,
          }),
        }),
      );
      const configured = await configuredResponse.json();

      expect(configuredResponse.status).toBe(200);
      expect(configured.summary.sent).toBe(configured.summary.total);
      expect(configured.results[0]).toMatchObject({
        provider: "email",
        deliveryMethod: "email-smtp",
        status: "sent",
        providerMessage: "email-message-1",
      });
      expect(createTransportMock).toHaveBeenCalledWith("smtp://localhost:1025");
      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "noreply@example.test",
          to: "user@example.test",
          subject: expect.any(String),
          text: expect.any(String),
        }),
      );
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("sends configured LINE notification jobs through the push API", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-line-dispatch-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;
    process.env.HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN = "line-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    try {
      const exportResponse = await exportState(
        new Request("http://localhost/api/state/export", {
          method: "POST",
          body: JSON.stringify({
            accountId: "acct-line-dispatch",
            state: {
              household: { channel: "line" },
            },
          }),
        }),
      );
      const exported = await exportResponse.json();

      const response = await dispatchNotifications(
        new Request("http://localhost/api/notifications/dispatch", {
          method: "POST",
          body: JSON.stringify({
            payload: exported.payload,
            contactPoints: { line: "U1234567890" },
            dryRun: false,
            dispatchedAt: "2026-06-15T00:00:01.000Z",
          }),
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.summary.sent).toBe(payload.summary.total);
      expect(payload.results[0]).toMatchObject({
        provider: "line",
        deliveryMethod: "line-push-api",
        status: "sent",
        providerStatus: 200,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.line.me/v2/bot/message/push",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer line-token",
            "content-type": "application/json",
          }),
        }),
      );
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(requestBody).toMatchObject({
        to: "U1234567890",
        messages: [expect.objectContaining({ type: "text" })],
      });
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it("sends configured Web Push notification jobs with VAPID credentials", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "home-stack-webpush-dispatch-"));
    process.env.HOME_STACK_STATE_STORE_DIR = storeDir;
    process.env.HOME_STACK_WEB_PUSH_PUBLIC_KEY = "public-key";
    process.env.HOME_STACK_WEB_PUSH_PRIVATE_KEY = "private-key";
    process.env.HOME_STACK_WEB_PUSH_SUBJECT = "mailto:ops@example.test";
    const setVapidDetailsMock = vi.spyOn(webPush, "setVapidDetails").mockImplementation(() => undefined);
    const sendNotificationMock = vi
      .spyOn(webPush, "sendNotification")
      .mockResolvedValue({ statusCode: 201, body: "", headers: { location: "push-message-id" } } as never);
    const subscription = {
      endpoint: "https://push.example.test/subscription",
      keys: { auth: "auth-secret", p256dh: "p256dh-key" },
    };

    try {
      const exportResponse = await exportState(
        new Request("http://localhost/api/state/export", {
          method: "POST",
          body: JSON.stringify({
            accountId: "acct-webpush-dispatch",
            state: {
              household: { channel: "webpush" },
            },
          }),
        }),
      );
      const exported = await exportResponse.json();

      const response = await dispatchNotifications(
        new Request("http://localhost/api/notifications/dispatch", {
          method: "POST",
          body: JSON.stringify({
            payload: exported.payload,
            contactPoints: { webpush: JSON.stringify(subscription) },
            dryRun: false,
            dispatchedAt: "2026-06-15T00:00:01.000Z",
          }),
        }),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.summary.sent).toBe(payload.summary.total);
      expect(payload.results[0]).toMatchObject({
        provider: "webpush",
        deliveryMethod: "web-push",
        status: "sent",
        providerStatus: 201,
        providerMessage: "push-message-id",
      });
      expect(setVapidDetailsMock).toHaveBeenCalledWith("mailto:ops@example.test", "public-key", "private-key");
      expect(sendNotificationMock).toHaveBeenCalledWith(subscription, expect.stringContaining('"title"'));
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });
});
