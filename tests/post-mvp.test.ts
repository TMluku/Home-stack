import { describe, expect, it } from "vitest";
import { baseOffers } from "../src/lib/offers";
import {
  buildMarketplaceSearchUrls,
  buildStaticPriceScanResults,
  buildStaticProductSearchResult,
  isValidJanCode,
  resolveJanProduct,
} from "../src/lib/post-mvp";

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
});
