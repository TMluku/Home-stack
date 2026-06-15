import { buildEffectivePriceQuote } from "./post-mvp";
import type { LivePriceResult } from "./types";

const MAX_HTML_BYTES = 1_500_000;

type PriceAdjustments = {
  shippingFee?: number;
  pointValue?: number;
  couponValue?: number;
  evidence: string[];
};

type ExtractedPrice = {
  price?: number;
  currency?: string;
  adjustments?: Partial<PriceAdjustments>;
  evidence?: string[];
};

export async function scrapePriceUrl(url: string): Promise<LivePriceResult> {
  const fetchedAt = new Date().toISOString();

  try {
    const normalizedUrl = normalizeHttpUrl(url);
    const response = await fetch(normalizedUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ja,en-US;q=0.8,en;q=0.6",
        "user-agent": "HomeStackPriceRadar/0.1 (+https://github.com/TMluku/Home-stack)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      return { url: normalizedUrl, ok: false, source: "none", fetchedAt, error: `HTTP ${response.status}` };
    }

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const extracted = extractPriceFromHtml(html);

    return {
      url: normalizedUrl,
      ok: Boolean(extracted.price),
      title: extracted.title,
      price: extracted.price,
      effectivePriceQuote: extracted.effectivePriceQuote,
      currency: extracted.currency,
      source: extracted.source,
      fetchedAt,
      error: extracted.price ? undefined : "価格を抽出できませんでした",
    };
  } catch (error) {
    return {
      url,
      ok: false,
      source: "none",
      fetchedAt,
      error: error instanceof Error ? error.message : "取得に失敗しました",
    };
  }
}

export function extractPriceFromHtml(
  html: string,
): Pick<LivePriceResult, "title" | "price" | "effectivePriceQuote" | "currency" | "source"> {
  const title = extractTitle(html);
  const jsonLdPrice = extractJsonLdPrice(html);
  if (jsonLdPrice.price) return withEffectivePriceQuote({ title, ...jsonLdPrice, source: "json-ld" }, html);

  const metaPrice = extractMetaPrice(html);
  if (metaPrice.price) return withEffectivePriceQuote({ title, ...metaPrice, source: "meta" }, html);

  const textPrice = extractTextPrice(html);
  if (textPrice.price) return withEffectivePriceQuote({ title, ...textPrice, source: "html-text" }, html);

  return { title, source: "none" };
}

function normalizeHttpUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("http/https URLだけ取得できます");
  }
  return url.toString();
}

function extractTitle(html: string) {
  const ogTitle = matchContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (ogTitle) return decodeEntities(ogTitle);
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return title ? decodeEntities(title.trim()) : undefined;
}

function extractJsonLdPrice(html: string) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) =>
    decodeEntities(match[1].trim()),
  );

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      const result = findPriceInJsonLd(parsed);
      if (result.price) return result;
    } catch {
      // Some sites emit invalid JSON-LD. Fall back to meta/text extraction.
    }
  }

  return {};
}

function findPriceInJsonLd(value: unknown): ExtractedPrice {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPriceInJsonLd(item);
      if (found.price) return found;
    }
    return {};
  }

  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const offers = record.offers ?? record.offer;
  if (offers) {
    const found = findPriceInJsonLd(offers);
    if (found.price) return found;
  }

  const rawPrice = record.price ?? record.lowPrice ?? record.highPrice;
  const price = parsePrice(rawPrice);
  if (price) {
    const adjustments = extractStructuredAdjustments(record);
    return {
      price,
      currency: typeof record.priceCurrency === "string" ? record.priceCurrency : undefined,
      adjustments,
      evidence: adjustments.evidence,
    };
  }

  for (const nested of Object.values(record)) {
    const found = findPriceInJsonLd(nested);
    if (found.price) return found;
  }

  return {};
}

function extractMetaPrice(html: string) {
  const candidates = [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:data1["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ];

  for (const pattern of candidates) {
    const value = matchContent(html, pattern);
    const price = parsePrice(value);
    if (price) {
      const adjustments = extractMetaAdjustments(html);
      return { price, currency: inferCurrency(value), adjustments, evidence: adjustments.evidence };
    }
  }

  return {};
}

function extractTextPrice(html: string) {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
  const priceText = text.match(/(?:税込|価格|price)?\s*(?:¥|￥)?\s*([0-9０-９][0-9０-９,，]*)(?:\s*(?:円|yen|JPY))/i)?.[0];
  const price = parsePrice(priceText);
  return price ? { price, currency: inferCurrency(priceText) } : {};
}

function withEffectivePriceQuote<T extends Pick<LivePriceResult, "title" | "price" | "currency" | "source">>(
  result: T & { adjustments?: Partial<PriceAdjustments>; evidence?: string[] },
  html: string,
): T & Pick<LivePriceResult, "effectivePriceQuote"> {
  if (!result.price) return result;
  const inferredAdjustments = inferPriceAdjustments(html, result.price);
  const adjustments = mergeAdjustments(result.adjustments, inferredAdjustments);
  const { adjustments: _adjustments, evidence: _evidence, ...visibleResult } = result;
  return {
    ...(visibleResult as T),
    effectivePriceQuote: appendAdjustmentEvidence(
      buildEffectivePriceQuote({
        listPrice: result.price,
        shippingFee: adjustments.shippingFee,
        pointValue: adjustments.pointValue,
        couponValue: adjustments.couponValue,
      }),
      adjustments.evidence,
    ),
  };
}

function mergeAdjustments(structured: Partial<PriceAdjustments> | undefined, inferred: PriceAdjustments): PriceAdjustments {
  return {
    shippingFee: structured?.shippingFee ?? inferred.shippingFee,
    pointValue: structured?.pointValue ?? inferred.pointValue,
    couponValue: structured?.couponValue ?? inferred.couponValue,
    evidence: [...(structured?.evidence ?? []), ...inferred.evidence],
  };
}

function appendAdjustmentEvidence(
  quote: NonNullable<LivePriceResult["effectivePriceQuote"]>,
  evidence: string[],
): NonNullable<LivePriceResult["effectivePriceQuote"]> {
  return {
    ...quote,
    evidence: [...quote.evidence, ...evidence],
  };
}

function extractStructuredAdjustments(record: Record<string, unknown>): PriceAdjustments {
  const shippingFee = extractJsonLdAmount(record.shippingDetails ?? record.shippingRate, ["shippingRate", "price", "value", "amount"]);
  const pointValue = extractAdditionalPropertyAmount(record, ["point", "points", "ポイント"]);
  const couponValue = extractAdditionalPropertyAmount(record, ["coupon", "discount", "クーポン", "値引"]);
  return {
    shippingFee,
    pointValue,
    couponValue,
    evidence: [
      typeof shippingFee === "number" ? `shipping fee from JSON-LD: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
      pointValue ? `point value from JSON-LD: ${pointValue.toLocaleString("ja-JP")} JPY` : "",
      couponValue ? `coupon value from JSON-LD: ${couponValue.toLocaleString("ja-JP")} JPY` : "",
    ].filter(Boolean),
  };
}

function extractJsonLdAmount(value: unknown, keys: string[]): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractJsonLdAmount(item, keys);
      if (typeof found === "number") return found;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return parsePrice(value);
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const amount = parsePrice(record[key]);
    if (amount) return amount;
  }
  for (const nested of Object.values(record)) {
    const amount = extractJsonLdAmount(nested, keys);
    if (typeof amount === "number") return amount;
  }
  return undefined;
}

function extractAdditionalPropertyAmount(record: Record<string, unknown>, labels: string[]): number | undefined {
  const properties = [record.additionalProperty, record.additionalProperties, record.priceSpecification].filter(Boolean);
  for (const property of properties) {
    const found = findNamedAmount(property, labels);
    if (found) return found;
  }
  return undefined;
}

function findNamedAmount(value: unknown, labels: string[]): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNamedAmount(item, labels);
      if (found) return found;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = String(record.name ?? record.propertyID ?? record["@type"] ?? "").toLowerCase();
  if (labels.some((label) => name.includes(label.toLowerCase()))) {
    return parsePrice(record.value ?? record.price ?? record.amount);
  }

  for (const nested of Object.values(record)) {
    const found = findNamedAmount(nested, labels);
    if (found) return found;
  }
  return undefined;
}

function extractMetaAdjustments(html: string): PriceAdjustments {
  const shippingFee = extractMetaAmount(html, ["shipping", "postage", "送料"]);
  const pointValue = extractMetaAmount(html, ["point", "points", "ポイント"]);
  const couponValue = extractMetaAmount(html, ["coupon", "discount", "クーポン", "値引"]);
  return {
    shippingFee,
    pointValue,
    couponValue,
    evidence: [
      typeof shippingFee === "number" ? `shipping fee from meta tag: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
      pointValue ? `point value from meta tag: ${pointValue.toLocaleString("ja-JP")} JPY` : "",
      couponValue ? `coupon value from meta tag: ${couponValue.toLocaleString("ja-JP")} JPY` : "",
    ].filter(Boolean),
  };
}

function extractMetaAmount(html: string, keys: string[]) {
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of metaTags) {
    const descriptor = [
      matchContent(tag, /\b(?:property|name|itemprop)=["']([^"']+)["']/i),
      matchContent(tag, /\bcontent=["']([^"']+)["']/i),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!keys.some((key) => descriptor.includes(key.toLowerCase()))) continue;
    const amount = parsePrice(matchContent(tag, /\bcontent=["']([^"']+)["']/i));
    if (typeof amount === "number") return amount;
  }
  return undefined;
}

function inferPriceAdjustments(html: string, listPrice: number): PriceAdjustments {
  const text = extractPlainText(html);
  const freeShipping = /送料無料|送料\s*0|free shipping/i.test(text);
  const shippingFee = freeShipping ? 0 : extractAmountAroundLabel(text, ["送料", "shipping", "postage"]);
  const pointValue = extractPointValue(text, listPrice);
  const couponValue = extractCouponValue(text, listPrice);
  return {
    shippingFee,
    pointValue,
    couponValue,
    evidence: [
      typeof shippingFee === "number" ? `shipping fee from page text: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
      pointValue ? `point value from page text: ${pointValue.toLocaleString("ja-JP")} JPY` : "",
      couponValue ? `coupon value from page text: ${couponValue.toLocaleString("ja-JP")} JPY` : "",
    ].filter(Boolean),
  };
}

function extractPlainText(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}

function extractPointValue(text: string, listPrice: number) {
  const explicit = extractAmountAroundLabel(text, ["ポイント", "point", "points"]);
  if (explicit) return explicit;
  const rate = extractRateAroundLabel(text, ["ポイント", "point", "points"]);
  return rate ? Math.round(listPrice * (rate / 100)) : undefined;
}

function extractCouponValue(text: string, listPrice: number) {
  const explicit = extractAmountAroundLabel(text, ["クーポン", "coupon", "値引", "discount"]);
  if (explicit) return explicit;
  const rate = extractRateAroundLabel(text, ["クーポン", "coupon", "off", "discount"]);
  return rate ? Math.round(listPrice * (rate / 100)) : undefined;
}

function extractAmountAroundLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`${escaped}[^0-9０-９]{0,16}(?:¥|￥|JPY)?\\s*([0-9０-９][0-9０-９,，]*)`, "i"),
      new RegExp(`(?:¥|￥|JPY)?\\s*([0-9０-９][0-9０-９,，]*)[^0-9０-９]{0,16}${escaped}`, "i"),
    ];
    for (const pattern of patterns) {
      const amount = parsePrice(text.match(pattern)?.[1]);
      if (amount) return amount;
    }
  }
  return undefined;
}

function extractRateAroundLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`${escaped}[^0-9０-９]{0,16}([0-9０-９]{1,2})\\s*%`, "i"),
      new RegExp(`([0-9０-９]{1,2})\\s*%[^0-9０-９]{0,16}${escaped}`, "i"),
    ];
    for (const pattern of patterns) {
      const rate = parsePrice(text.match(pattern)?.[1]);
      if (rate && rate <= 80) return rate;
    }
  }
  return undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchContent(html: string, pattern: RegExp) {
  return html.match(pattern)?.[1]?.trim();
}

function parsePrice(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return undefined;
  const normalized = toHalfWidth(value)
    .replace(/[,，]/g, "")
    .match(/[0-9]+(?:\.[0-9]+)?/)?.[0];
  const price = normalized ? Number(normalized) : NaN;
  return Number.isFinite(price) ? Math.round(price) : undefined;
}

function inferCurrency(value?: string) {
  if (!value) return undefined;
  if (/JPY|円|¥|￥/i.test(value)) return "JPY";
  return undefined;
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toHalfWidth(value: string) {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}
