import { buildEffectivePriceQuote } from "./post-mvp";
import type { LivePriceResult } from "./types";

const MAX_HTML_BYTES = 1_500_000;

type PriceAdjustments = {
  shippingFee?: number;
  pointValue?: number;
  couponValue?: number;
  conditionLabels?: string[];
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

  const embeddedJsonPrice = extractEmbeddedJsonPrice(html);
  if (embeddedJsonPrice.price) return withEffectivePriceQuote({ title, ...embeddedJsonPrice, source: "embedded-json" }, html);

  const attributePrice = extractAttributePrice(html);
  if (attributePrice.price) return withEffectivePriceQuote({ title, ...attributePrice, source: "data-attribute" }, html);

  const amazonPrice = extractAmazonPrice(html);
  if (amazonPrice.price) return withEffectivePriceQuote({ title, ...amazonPrice, source: "html-text" }, html);

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

function extractEmbeddedJsonPrice(html: string) {
  const scripts = [...html.matchAll(/<script\b(?![^>]+type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => decodeEntities(match[1].trim()))
    .filter((script) => script.startsWith("{") || script.startsWith("["));

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      const result = findPriceInEmbeddedJson(parsed);
      if (result.price) return result;
    } catch {
      // Embedded app-state scripts are often not plain JSON. Fall back to attribute/text extraction.
    }
  }

  return {};
}

function findPriceInEmbeddedJson(value: unknown): ExtractedPrice {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPriceInEmbeddedJson(item);
      if (found.price) return found;
    }
    return {};
  }

  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;

  const offerLike = record.offers ?? record.offer ?? record.priceSpecification;
  if (offerLike) {
    const found = findPriceInEmbeddedJson(offerLike);
    if (found.price) return found;
  }

  const price = extractFirstAmountForKeys(record, ["salePrice", "currentPrice", "itemPrice", "taxIncludedPrice", "price"]);
  if (price && isEmbeddedProductRecord(record)) {
    const adjustments = extractEmbeddedAdjustments(record);
    return {
      price,
      currency: inferCurrency(String(record.currency ?? record.priceCurrency ?? "")),
      adjustments,
      evidence: adjustments.evidence,
    };
  }

  for (const nested of Object.values(record)) {
    const found = findPriceInEmbeddedJson(nested);
    if (found.price) return found;
  }

  return {};
}

function extractAttributePrice(html: string) {
  const tags = [...html.matchAll(/<[^>]+>/g)].map((match) => match[0]);
  const priceAttributePattern = /\b(?:data-(?:sale-)?price|data-item-price|data-current-price)=["']([^"']+)["']/i;

  for (const tag of tags) {
    const price = parsePrice(matchContent(tag, priceAttributePattern));
    if (price) return { price, currency: inferCurrency(tag) };
  }

  return {};
}

function extractAmazonPrice(html: string): ExtractedPrice {
  const offscreenPrice = findAmazonOffscreenPrice(html);
  if (offscreenPrice) {
    return { price: offscreenPrice, currency: "JPY", evidence: ["price from Amazon a-offscreen"] };
  }

  const splitPrice = findAmazonSplitPrice(html);
  if (splitPrice) {
    return { price: splitPrice, currency: "JPY", evidence: ["price from Amazon split whole/fraction"] };
  }

  return {};
}

function findAmazonOffscreenPrice(html: string) {
  const blocks = [...html.matchAll(/<span\b[^>]*class=["'][^"']*\ba-price\b[^"']*["'][^>]*>[\s\S]{0,700}?<\/span>\s*<\/span>/gi)].map(
    (match) => match[0],
  );
  for (const block of blocks) {
    if (/a-text-price|listPrice|basisPrice|savings/i.test(block)) continue;
    const value = block.match(/<span\b[^>]*class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
    const price = parsePrice(value);
    if (price) return price;
  }
  return undefined;
}

function findAmazonSplitPrice(html: string) {
  const block = html.match(/<span\b[^>]*class=["'][^"']*\ba-price\b[^"']*["'][^>]*>[\s\S]{0,900}?<\/span>\s*<\/span>/i)?.[0];
  if (!block || /a-text-price|listPrice|basisPrice|savings/i.test(block)) return undefined;
  const whole = block.match(/<span\b[^>]*class=["'][^"']*\ba-price-whole\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
  const fraction = block.match(/<span\b[^>]*class=["'][^"']*\ba-price-fraction\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
  const wholePrice = parsePrice(whole);
  if (!wholePrice) return undefined;
  const fractionPrice = parsePrice(fraction);
  return fractionPrice ? Math.round(wholePrice + fractionPrice / 100) : wholePrice;
}

function extractTextPrice(html: string) {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
  const pricePattern = /(?:税込|価格|price)?\s*(?:¥|￥)?\s*([0-9０-９][0-9０-９,，]*)(?:\s*(?:円|yen|JPY))/gi;
  for (const match of text.matchAll(pricePattern)) {
    const priceText = match[0];
    if (isUnitPriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isTaxExcludedContext(text, match.index ?? 0, priceText.length)) continue;
    if (isReferencePriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isUnavailablePriceContext(text, match.index ?? 0, priceText.length)) continue;
    const price = parsePrice(priceText);
    if (price) return { price, currency: inferCurrency(priceText) };
  }
  return {};
}

function withEffectivePriceQuote<T extends Pick<LivePriceResult, "title" | "price" | "currency" | "source">>(
  result: T & { adjustments?: Partial<PriceAdjustments>; evidence?: string[] },
  html: string,
): T & Pick<LivePriceResult, "effectivePriceQuote"> {
  if (!result.price) return result;
  const inferredAdjustments = inferPriceAdjustments(html, result.price);
  const adjustments = mergeAdjustments(result.adjustments, inferredAdjustments);
  const { adjustments: _adjustments, evidence: _evidence, ...visibleResult } = result;
  const evidence = [...(result.evidence ?? []), ...adjustments.evidence];
  return {
    ...(visibleResult as T),
    effectivePriceQuote: appendAdjustmentEvidence(
      buildEffectivePriceQuote({
        listPrice: result.price,
        shippingFee: adjustments.shippingFee,
        pointValue: adjustments.pointValue,
        couponValue: adjustments.couponValue,
      }),
      evidence,
    ),
  };
}

function mergeAdjustments(structured: Partial<PriceAdjustments> | undefined, inferred: PriceAdjustments): PriceAdjustments {
  return {
    shippingFee: structured?.shippingFee ?? inferred.shippingFee,
    pointValue: structured?.pointValue ?? inferred.pointValue,
    couponValue: structured?.couponValue ?? inferred.couponValue,
    conditionLabels: [...(structured?.conditionLabels ?? []), ...(inferred.conditionLabels ?? [])],
    evidence: [...(structured?.evidence ?? []), ...inferred.evidence],
  };
}

function appendAdjustmentEvidence(
  quote: NonNullable<LivePriceResult["effectivePriceQuote"]>,
  evidence: string[],
): NonNullable<LivePriceResult["effectivePriceQuote"]> {
  const conditionLabels = [...new Set([...quote.conditionLabels, ...evidenceToConditionLabels(evidence)])];
  return {
    ...quote,
    conditionLabels,
    conditionRequired: conditionLabels.length > 0,
    evidence: [...quote.evidence, ...evidence],
  };
}

function evidenceToConditionLabels(evidence: string[]) {
  return [
    evidence.some((entry) => entry.includes("shipping condition requires retailer confirmation")) ? "送料条件あり" : "",
    evidence.some((entry) => entry.includes("point condition requires retailer confirmation")) ? "ポイント条件あり" : "",
    evidence.some((entry) => entry.includes("coupon condition requires retailer confirmation")) ? "クーポン条件あり" : "",
  ].filter(Boolean);
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

function extractEmbeddedAdjustments(record: Record<string, unknown>): PriceAdjustments {
  const shippingFee = extractFirstAmountForKeys(record, ["shippingFee", "shipping", "postage", "deliveryFee"]);
  const pointValue = extractFirstAmountForKeys(record, ["pointValue", "pointAmount", "points", "rewardPoint"]);
  const couponValue = extractFirstAmountForKeys(record, ["couponValue", "couponAmount", "coupon", "discount", "discountAmount"]);
  return {
    shippingFee,
    pointValue,
    couponValue,
    evidence: [
      typeof shippingFee === "number" ? `shipping fee from embedded JSON: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
      pointValue ? `point value from embedded JSON: ${pointValue.toLocaleString("ja-JP")} JPY` : "",
      couponValue ? `coupon value from embedded JSON: ${couponValue.toLocaleString("ja-JP")} JPY` : "",
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

function extractFirstAmountForKeys(value: unknown, keys: string[]): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstAmountForKeys(item, keys);
      if (typeof found === "number") return found;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, rawValue] of Object.entries(record)) {
    if (keys.some((candidate) => key.toLowerCase() === candidate.toLowerCase())) {
      const amount = parseAmountPayload(rawValue);
      if (amount) return amount;
    }
  }

  for (const nested of Object.values(record)) {
    const found = extractFirstAmountForKeys(nested, keys);
    if (typeof found === "number") return found;
  }
  return undefined;
}

function parseAmountPayload(value: unknown) {
  const direct = parsePrice(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return parsePrice(record.amount ?? record.value ?? record.price);
}

function isEmbeddedProductRecord(record: Record<string, unknown>) {
  const productKeys = ["name", "title", "productName", "itemName", "sku", "janCode"];
  const hasProductIdentity = productKeys.some((key) => typeof record[key] === "string" && String(record[key]).trim().length > 0);
  const currency = String(record.currency ?? record.priceCurrency ?? "").toUpperCase();
  return hasProductIdentity || currency === "JPY";
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
    if (keys.some((key) => /point/i.test(key)) && hasRewardMultiplierCopy(descriptor, ["point", "points"])) continue;
    const amount = parsePrice(matchContent(tag, /\bcontent=["']([^"']+)["']/i));
    if (typeof amount === "number") return amount;
  }
  return undefined;
}

function inferPriceAdjustments(html: string, listPrice: number): PriceAdjustments {
  const text = extractPlainText(html);
  const shippingConditionRequired = hasConditionalShippingCopy(text);
  const shippingFee = extractShippingFeeFromText(text);
  const pointValue = extractPointValue(text, listPrice);
  const couponValue = extractCouponValue(text, listPrice);
  const pointConditionRequired =
    !pointValue &&
    (hasAmbiguousRewardCopy(text, ["point", "points", "ポイント"]) ||
      hasRewardMultiplierCopy(text, ["point", "points", "ポイント"]) ||
      hasRewardThresholdCopy(text, ["point", "points", "ポイント"]));
  const couponConditionRequired =
    !couponValue &&
    (hasAmbiguousRewardCopy(text, ["coupon", "discount", "off", "クーポン"]) ||
      hasRewardThresholdCopy(text, ["coupon", "discount", "off", "クーポン"]));
  return {
    shippingFee,
    pointValue,
    couponValue,
    conditionLabels: [
      shippingConditionRequired ? "送料条件あり" : "",
      pointConditionRequired ? "ポイント条件あり" : "",
      couponConditionRequired ? "クーポン条件あり" : "",
    ].filter(Boolean),
    evidence: [
      typeof shippingFee === "number" ? `shipping fee from page text: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
      shippingConditionRequired ? "shipping condition requires retailer confirmation" : "",
      pointValue ? `point value from page text: ${pointValue.toLocaleString("ja-JP")} JPY` : "",
      pointConditionRequired ? "point condition requires retailer confirmation" : "",
      couponValue ? `coupon value from page text: ${couponValue.toLocaleString("ja-JP")} JPY` : "",
      couponConditionRequired ? "coupon condition requires retailer confirmation" : "",
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
  if (hasAmbiguousRewardCopy(text, ["point", "points", "ポイント"])) return undefined;
  if (hasRewardMultiplierCopy(text, ["point", "points", "ポイント"])) return undefined;
  if (hasRewardThresholdCopy(text, ["point", "points", "ポイント"])) return undefined;
  const explicit = extractAmountAroundLabel(text, ["ポイント", "point", "points"]);
  if (explicit && explicit / listPrice <= 0.35) return explicit;
  const rate = extractRateAroundLabel(text, ["ポイント", "point", "points"]);
  return rate && rate <= 30 ? Math.round(listPrice * (rate / 100)) : undefined;
}

function extractCouponValue(text: string, listPrice: number) {
  if (hasAmbiguousRewardCopy(text, ["coupon", "discount", "off", "クーポン"])) return undefined;
  if (hasRewardThresholdCopy(text, ["coupon", "discount", "off", "クーポン"])) return undefined;
  const explicit = extractAmountAroundLabel(text, ["クーポン", "coupon", "値引", "discount"]);
  if (explicit && explicit / listPrice <= 0.6) return explicit;
  const rate = extractRateAroundLabel(text, ["クーポン", "coupon", "off", "discount"]);
  return rate && rate <= 60 ? Math.round(listPrice * (rate / 100)) : undefined;
}

function extractShippingFeeFromText(text: string) {
  if (hasCertainFreeShippingCopy(text)) return 0;
  if (hasConditionalShippingCopy(text)) return undefined;
  return extractAmountAroundLabel(text, ["送料", "shipping", "postage"]);
}

function hasCertainFreeShippingCopy(text: string) {
  return !hasConditionalShippingCopy(text) && /送料無料|送料\s*0|free shipping/i.test(text);
}

function hasConditionalShippingCopy(text: string) {
  const shippingLabels = ["送料", "shipping", "postage", "delivery"];
  const conditionWords = [
    "送料無料ライン",
    "以上",
    "未満",
    "対象",
    "条件",
    "会員",
    "プライム",
    "定期",
    "まとめ買い",
    "over",
    "above",
    "minimum",
    "eligible",
    "membership",
    "members only",
    "prime",
    "subscription",
  ];

  return shippingLabels.some((label) =>
    conditionWords.some((word) => {
      const escapedLabel = escapeRegExp(label);
      const escapedWord = escapeRegExp(word);
      return (
        new RegExp(`${escapedLabel}.{0,36}${escapedWord}`, "i").test(text) ||
        new RegExp(`${escapedWord}.{0,36}${escapedLabel}`, "i").test(text)
      );
    }),
  );
}

function hasAmbiguousRewardCopy(text: string, labels: string[]) {
  const ambiguousWords = [
    "最大",
    "上限",
    "抽選",
    "予定",
    "対象者限定",
    "要エントリー",
    "up to",
    "max",
    "maximum",
    "campaign",
    "entry required",
    "eligible only",
    "members only",
    "requires",
  ];
  return labels.some((label) =>
    ambiguousWords.some((word) => {
      const escapedLabel = escapeRegExp(label);
      const escapedWord = escapeRegExp(word);
      return (
        new RegExp(`${escapedWord}.{0,28}${escapedLabel}`, "i").test(text) ||
        new RegExp(`${escapedLabel}.{0,28}${escapedWord}`, "i").test(text)
      );
    }),
  );
}

function hasRewardMultiplierCopy(text: string, labels: string[]) {
  return labels.some((label) => {
    const escapedLabel = escapeRegExp(label);
    return (
      new RegExp(`${escapedLabel}.{0,20}[0-9０-９]{1,2}\\s*(?:x|times|倍|倍率)`, "i").test(text) ||
      new RegExp(`[0-9０-９]{1,2}\\s*(?:x|times|倍|倍率).{0,20}${escapedLabel}`, "i").test(text)
    );
  });
}

function hasRewardThresholdCopy(text: string, labels: string[]) {
  const conditionWords = [
    "以上",
    "未満",
    "対象",
    "条件",
    "購入",
    "まとめ買い",
    "when",
    "if",
    "buy",
    "buying",
    "purchase",
    "spend",
    "orders over",
    "minimum",
    "or more",
  ];
  return labels.some((label) =>
    conditionWords.some((word) => {
      const escapedLabel = escapeRegExp(label);
      const escapedWord = escapeRegExp(word);
      return (
        new RegExp(`${escapedLabel}.{0,40}${escapedWord}`, "i").test(text) ||
        new RegExp(`${escapedWord}.{0,40}${escapedLabel}`, "i").test(text)
      );
    }),
  );
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

function isUnitPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(index + length, index + length + 28);
  return (
    /(?:\/|／|per\s*)\s*(?:100)?\s*(?:g|kg|ml|l|個|枚|本|袋|回)/i.test(after) ||
    /(?:100\s*)?(?:g|kg|ml|l|個|枚|本|袋|回)\s*(?:あたり|当たり|単価)\s*$/i.test(before)
  );
}

function isTaxExcludedContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(index + length, index + length + 18);
  return (
    /(?:税抜|税別|本体価格|excluding tax|tax excluded|excl\.?\s*tax)\s*$/i.test(before) ||
    /^\s*(?:税抜|税別|excluding tax|tax excluded|excl\.?\s*tax)/i.test(after)
  );
}

function isReferencePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 22), index);
  const after = text.slice(index + length, index + length + 18);
  const labelPrefix = `${before.replace(/^.*[0-9０-９][^0-9０-９]*/, "")}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  return (
    /(?:通常価格|参考価格|メーカー希望小売価格|定価|list price|regular price|was price|original price)\s*$/i.test(labelPrefix) ||
    /(?:通常価格|参考価格|メーカー希望小売価格|定価|list price|regular price|was price|original price)\s*$/i.test(before) ||
    /^\s*(?:通常価格|参考価格|メーカー希望小売価格|定価|list price|regular price|was price|original price)/i.test(after)
  );
}

function isUnavailablePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 24);
  const labelPrefix = `${before.replace(/^.*[0-9０-９][^0-9０-９]*/, "")}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  const words = /(?:在庫なし|売り切れ|売切れ|販売終了|入荷待ち|品切れ|sold out|out of stock|unavailable|discontinued)/i;
  return words.test(labelPrefix) || words.test(after);
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
