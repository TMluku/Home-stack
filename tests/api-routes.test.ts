import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as prepareNotifications } from "../src/app/api/notifications/prepare/route";
import { POST as scanPrices } from "../src/app/api/price-scan/route";
import { POST as searchProducts } from "../src/app/api/product-search/route";
import { POST as exportState } from "../src/app/api/state/export/route";
import { POST as loadState } from "../src/app/api/state/load/route";
import { POST as resetState } from "../src/app/api/state/reset/route";
import { POST as saveState } from "../src/app/api/state/save/route";

describe("API route contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HOME_STACK_STATE_STORE_DIR;
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
});
