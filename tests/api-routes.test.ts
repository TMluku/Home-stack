import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import webPush from "web-push";
import { POST as listAccounts } from "../src/app/api/account/list/route";
import { POST as resolveAccount } from "../src/app/api/account/resolve/route";
import { POST as getAccountSession } from "../src/app/api/account/session/route";
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
import { POST as detectPhotoInventory } from "../src/app/api/photo-detections/route";
import { POST as getPhotoDetectionStatus } from "../src/app/api/photo-detections/status/route";
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
    delete process.env.HOME_STACK_TRUSTED_EMAIL_HEADER;
    delete process.env.HOME_STACK_TRUSTED_SUBJECT_HEADER;
    delete process.env.HOME_STACK_TRUSTED_PROVIDER_HEADER;
    delete process.env.HOME_STACK_TRUSTED_DISPLAY_NAME_HEADER;
    delete process.env.HOME_STACK_TRUSTED_EMAIL_VERIFIED_HEADER;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    delete process.env.HOME_STACK_BARCODE_MASTER_URL;
    delete process.env.HOME_STACK_EMAIL_FROM;
    delete process.env.HOME_STACK_EMAIL_TRANSPORT;
    delete process.env.HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.HOME_STACK_WEB_PUSH_PUBLIC_KEY;
    delete process.env.HOME_STACK_WEB_PUSH_PRIVATE_KEY;
    delete process.env.HOME_STACK_WEB_PUSH_SUBJECT;
    delete process.env.RAKUTEN_APPLICATION_ID;
    delete process.env.YAHOO_SHOPPING_APP_ID;
    delete process.env.HOME_STACK_IMAGE_RECOGNITION_URL;
    delete process.env.HOME_STACK_IMAGE_RECOGNITION_TOKEN;
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

  it("normalizes official marketplace API shipping, point, coupon, and campaign windows", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Official detergent refill",
                  itemPrice: 2000,
                  itemUrl: "https://rakuten.example.test/item",
                  postageFlag: 0,
                  pointRate: 5,
                  pointRateStartTime: "2026-06-15T00:00:00+09:00",
                  pointRateEndTime: "2999-06-30T23:59:59+09:00",
                  couponAmount: 250,
                  couponStartTime: "2026-06-16T00:00:00+09:00",
                  couponEndTime: "2999-06-20T23:59:59+09:00",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          hits: [
            {
              name: "Official detergent refill Yahoo",
              url: "https://shopping.example.test/item",
              price: 2100,
              shipping: { code: 1, name: "送料無料" },
              point: { amount: 110, startTime: "2026-06-15T00:00:00+09:00", endTime: "2999-06-22T23:59:59+09:00" },
              coupon: { amount: 100, startTime: "2026-06-15T00:00:00+09:00", endTime: "2999-06-18T23:59:59+09:00" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "detergent refill" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(payload.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "rakuten", ok: true, count: 1 }),
        expect.objectContaining({ source: "yahoo-shopping", ok: true, count: 1 }),
      ]),
    );
    const rakutenCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "rakuten");
    const yahooCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "yahoo-shopping");
    const amazonLinkCandidate = payload.candidates.find(
      (candidate: { source: string; sourceLabel: string }) => candidate.source === "marketplace-link" && candidate.sourceLabel === "Amazon",
    );

    expect(rakutenCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 2000,
      shippingFee: 0,
      pointValue: 100,
      couponValue: 250,
      effectivePrice: 1650,
      conditionRequired: true,
    });
    expect(rakutenCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["ポイント期間あり", "クーポン期間あり"]));
    expect(rakutenCandidate.evidence).toEqual(
      expect.arrayContaining([
        "official shipping: free",
        "official point value: 100 JPY",
        "official coupon value: 250 JPY",
        "point window: 2026-06-15T00:00:00+09:00 - 2999-06-30T23:59:59+09:00",
        "coupon window: 2026-06-16T00:00:00+09:00 - 2999-06-20T23:59:59+09:00",
      ]),
    );
    expect(yahooCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 2100,
      shippingFee: 0,
      pointValue: 110,
      couponValue: 100,
      effectivePrice: 1890,
      conditionRequired: true,
    });
    expect(yahooCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["ポイント期間あり", "クーポン期間あり"]));
    expect(yahooCandidate.evidence).toEqual(
      expect.arrayContaining([
        "official shipping: free",
        "official point value: 110 JPY",
        "official coupon value: 100 JPY",
        "point window: 2026-06-15T00:00:00+09:00 - 2999-06-22T23:59:59+09:00",
        "coupon window: 2026-06-15T00:00:00+09:00 - 2999-06-18T23:59:59+09:00",
      ]),
    );
    expect(amazonLinkCandidate).toMatchObject({
      source: "marketplace-link",
      sourceLabel: "Amazon",
      shipping: "価格・送料条件は販売サイトで確認",
    });
    expect(amazonLinkCandidate.price).toBeUndefined();
  });

  it("filters official used or outlet marketplace records from replenishment candidates", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Official detergent refill outlet",
                  itemPrice: 900,
                  itemUrl: "https://rakuten.example.test/outlet",
                  condition: "アウトレット 開封済み",
                },
              },
              {
                Item: {
                  itemName: "Official detergent refill new",
                  itemPrice: 1200,
                  itemUrl: "https://rakuten.example.test/new",
                  condition: "NewCondition",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          hits: [
            {
              name: "Official detergent refill used",
              url: "https://shopping.example.test/used",
              price: 950,
              condition: "used",
            },
            {
              name: "Official detergent refill Yahoo new",
              url: "https://shopping.example.test/new",
              price: 1300,
              condition: "new",
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "detergent refill" }),
      }),
    );
    const payload = await response.json();
    const urls = payload.candidates.map((candidate: { url: string }) => candidate.url);

    expect(response.status).toBe(200);
    expect(urls).toEqual(expect.arrayContaining(["https://rakuten.example.test/new", "https://shopping.example.test/new"]));
    expect(urls).not.toEqual(expect.arrayContaining(["https://rakuten.example.test/outlet", "https://shopping.example.test/used"]));
  });

  it("sorts equal effective-price candidates by raw display price before match score", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Detergent refill exact query high display price",
                  itemPrice: 1000,
                  itemUrl: "https://rakuten.example.test/high-display",
                  couponAmount: 200,
                },
              },
              {
                Item: {
                  itemName: "Refill lower display price",
                  itemPrice: 900,
                  itemUrl: "https://rakuten.example.test/lower-display",
                  couponAmount: 100,
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "detergent refill exact query" }),
      }),
    );
    const payload = await response.json();
    const pricedCandidates = payload.candidates.filter((candidate: { source: string }) => candidate.source === "rakuten");

    expect(response.status).toBe(200);
    expect(pricedCandidates.map((candidate: { url: string }) => candidate.url)).toEqual([
      "https://rakuten.example.test/lower-display",
      "https://rakuten.example.test/high-display",
    ]);
    expect(
      pricedCandidates.map(
        (candidate: { effectivePriceQuote: { effectivePrice: number } }) => candidate.effectivePriceQuote.effectivePrice,
      ),
    ).toEqual([800, 800]);
  });

  it("does not treat official conditional shipping labels as guaranteed free shipping", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(JSON.stringify({ Items: [] }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          hits: [
            {
              name: "Conditional shipping Yahoo item",
              url: "https://shopping.example.test/conditional",
              price: 1000,
              shipping: { name: "free shipping on orders over 3,980 JPY" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "conditional shipping" }),
      }),
    );
    const payload = await response.json();
    const yahooCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "yahoo-shopping");

    expect(response.status).toBe(200);
    expect(yahooCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 1000,
      shippingFee: 0,
      effectivePrice: 1000,
      conditionRequired: true,
    });
    expect(yahooCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
    expect(yahooCandidate.evidence).toEqual(expect.arrayContaining(["official shipping condition requires retailer confirmation"]));
    expect(yahooCandidate.evidence).not.toEqual(expect.arrayContaining(["official shipping: free"]));
  });

  it("keeps official explicit free-shipping amounts conditional when threshold copy is present", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Threshold shipping Rakuten item",
                  itemPrice: 1200,
                  itemUrl: "https://rakuten.example.test/threshold-shipping",
                  shippingFee: 0,
                  shippingCondition: "送料無料ライン 3,980円以上で対象",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          hits: [
            {
              name: "Threshold shipping Yahoo item",
              url: "https://shopping.example.test/threshold-shipping",
              price: 1300,
              shippingFee: 0,
              shippingNote: "free shipping on orders over 3,980 JPY",
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "threshold shipping official" }),
      }),
    );
    const payload = await response.json();
    const rakutenCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "rakuten");
    const yahooCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "yahoo-shopping");

    expect(response.status).toBe(200);
    for (const candidate of [rakutenCandidate, yahooCandidate]) {
      expect(candidate.effectivePriceQuote).toMatchObject({
        shippingFee: 0,
        conditionRequired: true,
      });
      expect(candidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["送料条件あり"]));
      expect(candidate.evidence).toEqual(expect.arrayContaining(["official shipping condition requires retailer confirmation"]));
      expect(candidate.evidence).not.toEqual(expect.arrayContaining(["official shipping: free"]));
    }
  });

  it("keeps official ambiguous reward strings as conditions instead of discounts", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Ambiguous official Rakuten item",
                  itemPrice: 2000,
                  itemUrl: "https://rakuten.example.test/ambiguous",
                  pointRate: "最大50% 要エントリー",
                  couponAmount: "最大900円 対象者限定",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          hits: [
            {
              name: "Ambiguous official Yahoo item",
              url: "https://shopping.example.test/ambiguous",
              price: 2100,
              point: { amount: "up to 500 points entry required" },
              coupon: { amount: "coupon up to 900 eligible only" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "ambiguous official" }),
      }),
    );
    const payload = await response.json();
    const rakutenCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "rakuten");
    const yahooCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "yahoo-shopping");

    expect(response.status).toBe(200);
    expect(rakutenCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 2000,
      pointValue: 0,
      couponValue: 0,
      effectivePrice: 2000,
      conditionRequired: true,
    });
    expect(rakutenCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(rakutenCandidate.evidence).toEqual(
      expect.arrayContaining([
        "official point condition requires retailer confirmation",
        "official coupon condition requires retailer confirmation",
      ]),
    );
    expect(yahooCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 2100,
      pointValue: 0,
      couponValue: 0,
      effectivePrice: 2100,
      conditionRequired: true,
    });
    expect(yahooCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(yahooCandidate.evidence).toEqual(
      expect.arrayContaining([
        "official point condition requires retailer confirmation",
        "official coupon condition requires retailer confirmation",
      ]),
    );
  });

  it("keeps official delayed rewards and first-order coupons as conditions", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Delayed official Rakuten item",
                  itemPrice: 2000,
                  itemUrl: "https://rakuten.example.test/delayed",
                  pointRate: "PayPayポイント 150円相当 後日付与",
                  couponAmount: "初回限定クーポン 300円",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          hits: [
            {
              name: "Delayed official Yahoo item",
              url: "https://shopping.example.test/delayed",
              price: 2100,
              point: { amount: "PayPayポイント 120円相当 付与上限あり" },
              coupon: { amount: "LINE限定クーポン 300円" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "delayed official" }),
      }),
    );
    const payload = await response.json();
    const rakutenCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "rakuten");
    const yahooCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "yahoo-shopping");

    expect(response.status).toBe(200);
    expect(rakutenCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 2000,
      pointValue: 0,
      couponValue: 0,
      effectivePrice: 2000,
      conditionRequired: true,
    });
    expect(rakutenCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
    expect(yahooCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 2100,
      pointValue: 0,
      couponValue: 0,
      effectivePrice: 2100,
      conditionRequired: true,
    });
    expect(yahooCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["ポイント条件あり", "クーポン条件あり"]));
  });

  it("keeps official threshold coupons as conditions instead of guaranteed discounts", async () => {
    process.env.RAKUTEN_APPLICATION_ID = "rakuten-app";
    process.env.YAHOO_SHOPPING_APP_ID = "yahoo-app";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("app.rakuten.co.jp")) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Item: {
                  itemName: "Threshold official Rakuten item",
                  itemPrice: 2000,
                  itemUrl: "https://rakuten.example.test/threshold-coupon",
                  couponAmount: 300,
                  couponCondition: "coupon applies when buying 2 or more",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "threshold coupon official" }),
      }),
    );
    const payload = await response.json();
    const rakutenCandidate = payload.candidates.find((candidate: { source: string }) => candidate.source === "rakuten");

    expect(response.status).toBe(200);
    expect(rakutenCandidate.effectivePriceQuote).toMatchObject({
      listPrice: 2000,
      couponValue: 0,
      effectivePrice: 2000,
      conditionRequired: true,
    });
    expect(rakutenCandidate.effectivePriceQuote.conditionLabels).toEqual(expect.arrayContaining(["クーポン条件あり"]));
    expect(rakutenCandidate.evidence).toEqual(expect.arrayContaining(["official coupon condition requires retailer confirmation"]));
    expect(rakutenCandidate.evidence).not.toEqual(expect.arrayContaining(["official coupon value: 300 JPY"]));
  });

  it("ignores second-item deal prices when parsing marketplace HTML results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("search.rakuten.co.jp")) {
        return new Response(
          `
            <html>
              <body>
                <li>
                  <a href="https://rakuten.example.test/bundle-second-item">Detergent refill bundle</a>
                  <span>2点目 半額 900円</span>
                  <strong>販売価格 1,980円</strong>
                </li>
              </body>
            </html>
          `,
          { status: 200 },
        );
      }

      return new Response(
        `
          <html>
            <body>
              <article>
                <a href="https://shopping.example.test/bundle-second-item">Detergent refill Yahoo bundle</a>
                <span>second item price ¥900</span>
                <strong>item price ¥2,080</strong>
              </article>
            </body>
          </html>
        `,
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "detergent refill bundle" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://rakuten.example.test/bundle-second-item", price: 1980 }),
        expect.objectContaining({ url: "https://shopping.example.test/bundle-second-item", price: 2080 }),
      ]),
    );
    expect(payload.candidates.map((candidate: { price?: number }) => candidate.price)).not.toContain(900);
  });

  it("ignores member and app-only prices when parsing marketplace HTML results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("search.rakuten.co.jp")) {
        return new Response(
          `
            <html>
              <body>
                <li>
                  <a href="https://rakuten.example.test/member-price">Detergent refill member deal</a>
                  <span>会員限定価格 1,680円</span>
                  <strong>通常販売価格 1,980円</strong>
                </li>
              </body>
            </html>
          `,
          { status: 200 },
        );
      }

      return new Response(
        `
          <html>
            <body>
              <article>
                <a href="https://shopping.example.test/app-only-price">Detergent refill app deal</a>
                <span>app-only price ¥1,700</span>
                <strong>regular item price ¥2,080</strong>
              </article>
            </body>
          </html>
        `,
        { status: 200 },
      );
    });

    const response = await searchProducts(
      new Request("http://localhost/api/product-search", {
        method: "POST",
        body: JSON.stringify({ query: "detergent refill member deal" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://rakuten.example.test/member-price", price: 1980 }),
        expect.objectContaining({ url: "https://shopping.example.test/app-only-price", price: 2080 }),
      ]),
    );
    expect(payload.candidates.map((candidate: { price?: number }) => candidate.price)).not.toEqual(expect.arrayContaining([1680, 1700]));
  });

  it("normalizes external photo detection responses into inventory candidates", async () => {
    process.env.HOME_STACK_IMAGE_RECOGNITION_URL = "https://vision.example.test/detect";
    process.env.HOME_STACK_IMAGE_RECOGNITION_TOKEN = "vision-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detections: [
            {
              product_name: "External baby wipes",
              category: "ベビー用品",
              remainingPercent: 72,
              usagePerDay: 6,
              confidence: 0.91,
              model: "vision-v1",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const statusResponse = await getPhotoDetectionStatus();
    const status = await statusResponse.json();
    expect(status).toMatchObject({
      ok: true,
      status: {
        kind: "external-http",
        configuredBy: "env",
        endpoint: "https://vision.example.test/detect",
        ready: true,
      },
    });

    const response = await detectPhotoInventory(
      new Request("http://localhost/api/photo-detections", {
        method: "POST",
        body: JSON.stringify({ imageData: "data:image/png;base64,AAA=", mimeType: "image/png" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://vision.example.test/detect",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer vision-token",
          "content-type": "application/json",
        }),
      }),
    );
    expect(payload.detection).toMatchObject({
      source: "external-http",
      candidates: [
        {
          name: "External baby wipes",
          stock: 72,
          dailyUsage: 6,
          confidence: "high",
        },
      ],
      evidence: ["matched external image recognition response", "normalized external photo detection payload"],
    });
    expect(payload.detection.candidates[0].evidence).toEqual(
      expect.arrayContaining(["external image recognition candidate", "confidence: 0.91", "source: vision-v1"]),
    );
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

  it("resolves production account sessions from trusted identity headers", async () => {
    const response = await getAccountSession(
      new Request("http://localhost/api/account/session", {
        method: "POST",
        headers: {
          "x-home-stack-user-email": " USER@example.TEST ",
          "x-home-stack-auth-provider": "google",
          "x-home-stack-display-name": "Home User",
          "x-home-stack-email-verified": "true",
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      authenticated: true,
      profile: {
        authMode: "oauth",
        provider: "google",
        displayName: "Home User",
        verified: true,
      },
      context: {
        source: "trusted-identity",
        required: false,
      },
      status: {
        supports: {
          accountState: true,
          auditEvents: true,
          notificationEvents: true,
        },
      },
    });
    expect(payload.profile.accountId).toMatch(/^acct-/);
    expect(JSON.stringify(payload.profile)).not.toContain("USER@example.TEST");
    expect(JSON.stringify(payload.profile)).not.toContain("user@example.test");
  });

  it("requires trusted identity headers for production account sessions when auth is required", async () => {
    process.env.HOME_STACK_ACCOUNT_AUTH_REQUIRED = "true";

    const missingResponse = await getAccountSession(new Request("http://localhost/api/account/session", { method: "POST" }));
    const missing = await missingResponse.json();

    expect(missingResponse.status).toBe(401);
    expect(missing).toMatchObject({
      ok: false,
      authenticated: false,
      context: { required: true, source: "missing" },
      profile: null,
    });

    const authenticatedResponse = await getAccountSession(
      new Request("http://localhost/api/account/session", {
        method: "POST",
        headers: {
          "x-home-stack-user-sub": "provider-user-123",
          "x-home-stack-auth-provider": "github",
          "x-home-stack-display-name": "Ops User",
          "x-home-stack-email-verified": "1",
        },
      }),
    );
    const authenticated = await authenticatedResponse.json();

    expect(authenticatedResponse.status).toBe(200);
    expect(authenticated).toMatchObject({
      ok: true,
      authenticated: true,
      profile: {
        accountId: "acct-github-provider-user-123",
        authMode: "oauth",
        provider: "github",
        displayName: "Ops User",
        verified: true,
      },
      context: {
        accountId: "acct-github-provider-user-123",
        required: true,
        source: "trusted-identity",
      },
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
