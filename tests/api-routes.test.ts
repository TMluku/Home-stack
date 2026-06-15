import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as scanPrices } from "../src/app/api/price-scan/route";
import { POST as searchProducts } from "../src/app/api/product-search/route";
import { POST as exportState } from "../src/app/api/state/export/route";

describe("API route contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
