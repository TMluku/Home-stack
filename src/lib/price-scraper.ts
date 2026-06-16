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

type RewardSignal = {
  value?: number;
  conditionRequired?: boolean;
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

  const rawPrice = record.price;
  const price = parsePrice(rawPrice);
  const recordText = collectStructuredText(record);
  if (price && !hasUsedConditionCopy(recordText) && !hasSampleTrialProductCopy(recordText)) {
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
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  const candidates = [
    { attribute: "property", value: "product:price:amount" },
    { attribute: "property", value: "og:price:amount" },
    { attribute: "name", value: "twitter:data1" },
    { attribute: "itemprop", value: "price" },
  ];

  for (const candidate of candidates) {
    const tag = metaTags.find(
      (metaTag) => matchContent(metaTag, new RegExp(`\\b${candidate.attribute}=["']([^"']+)["']`, "i")) === candidate.value,
    );
    const content = tag ? matchContent(tag, /\bcontent=["']([^"']+)["']/i) : undefined;
    if (tag && content && isNonProductMetaAmountContext(tag, content)) continue;
    const price = parsePrice(content);
    if (price) {
      const adjustments = extractMetaAdjustments(html);
      return { price, currency: inferCurrency(content), adjustments, evidence: adjustments.evidence };
    }
  }

  return {};
}

function isNonProductMetaAmountContext(tag: string, value: string) {
  const context = extractPlainText(`${tag} ${value}`) || `${tag} ${value}`;
  return /(?:ポイント|還元|付与|獲得|クーポン|割引|値引|送料|配送料|配送|送料無料|商品券|ギフト券|point|points|reward|cashback|coupon|discount|off|shipping|postage|delivery|free shipping|gift card|gift certificate|voucher|store credit)/i.test(
    context,
  );
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
  const recordText = collectStructuredText(record);
  if (price && isEmbeddedProductRecord(record) && !hasUsedConditionCopy(recordText) && !hasSampleTrialProductCopy(recordText)) {
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
    const decodedTag = decodeEntities(tag);
    if (hasUsedConditionCopy(decodedTag)) continue;
    if (hasSampleTrialProductCopy(decodedTag)) continue;
    if (hasPurchaseConditionCopy(decodedTag)) continue;
    if (hasRestrictedPriceCopy(decodedTag)) continue;
    if (hasCartOnlyPriceCopy(decodedTag)) continue;
    if (hasConditionalDiscountPriceCopy(decodedTag)) continue;
    if (hasPaymentFeeCopy(decodedTag)) continue;
    if (hasConditionalShippingCopy(decodedTag)) continue;
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
  const blocks = [...html.matchAll(/<span\b[^>]*class=["'][^"']*\ba-price\b[^"']*["'][^>]*>[\s\S]{0,700}?<\/span>\s*<\/span>/gi)];
  for (const match of blocks) {
    const block = match[0];
    if (/a-text-price|listPrice|basisPrice|savings/i.test(block)) continue;
    if (isAmazonSuppressedPriceContext(html, match.index ?? 0, block.length)) continue;
    const value = block.match(/<span\b[^>]*class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
    const price = parsePrice(value);
    if (price) return price;
  }
  return undefined;
}

function findAmazonSplitPrice(html: string) {
  const blocks = [...html.matchAll(/<span\b[^>]*class=["'][^"']*\ba-price\b[^"']*["'][^>]*>[\s\S]{0,900}?<\/span>\s*<\/span>/gi)];
  for (const match of blocks) {
    const block = match[0];
    if (/a-text-price|listPrice|basisPrice|savings/i.test(block)) continue;
    if (isAmazonSuppressedPriceContext(html, match.index ?? 0, block.length)) continue;
    const whole = block.match(/<span\b[^>]*class=["'][^"']*\ba-price-whole\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
    const fraction = block.match(/<span\b[^>]*class=["'][^"']*\ba-price-fraction\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1];
    const wholePrice = parsePrice(whole);
    if (!wholePrice) continue;
    const fractionPrice = parsePrice(fraction);
    return fractionPrice ? Math.round(wholePrice + fractionPrice / 100) : wholePrice;
  }
  return undefined;
}

function isAmazonSuppressedPriceContext(html: string, index: number, length: number) {
  const context = extractPlainText(html.slice(Math.max(0, index - 220), index + length + 220));
  return (
    hasPurchaseConditionCopy(context) ||
    hasConditionalDiscountPriceCopy(context) ||
    hasUsedConditionCopy(context) ||
    hasCartOnlyPriceCopy(context) ||
    hasRestrictedAmazonOfferPriceCopy(context) ||
    hasUnavailableConditionCopy(context) ||
    isUnavailablePriceContext(context, Math.min(900, context.length), 0)
  );
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
    if (isPackComponentPriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isSampleTrialPriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isAdditionalItemPriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isRangeLowerBoundPriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isEffectivePriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isCartOnlyPriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isInstallmentAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isStandaloneShippingFeeAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isNonProductFeeAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isRewardAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isConditionThresholdAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isDiscountAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isCouponAppliedPriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isFreeShippingProgressAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isShippingConditionAmountContext(text, match.index ?? 0, priceText.length)) continue;
    if (isTaxExcludedContext(text, match.index ?? 0, priceText.length)) continue;
    if (isReferencePriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isExpiredSalePriceContext(text, match.index ?? 0, priceText.length)) continue;
    if (isUsedConditionPriceContext(text, match.index ?? 0, priceText.length)) continue;
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
    evidence.some((entry) => entry.includes("purchase condition requires retailer confirmation")) ? "購入条件あり" : "",
    evidence.some((entry) => entry.includes("point condition requires retailer confirmation")) ? "ポイント条件あり" : "",
    evidence.some((entry) => entry.includes("coupon condition requires retailer confirmation")) ? "クーポン条件あり" : "",
  ].filter(Boolean);
}

function extractStructuredAdjustments(record: Record<string, unknown>): PriceAdjustments {
  const shippingSignal = extractJsonLdShippingSignal(record.shippingDetails ?? record.shippingRate);
  const pointSignal = extractAdditionalPropertyReward(record, ["point", "points", "ポイント"]);
  const couponSignal = extractAdditionalPropertyReward(record, ["coupon", "discount", "クーポン", "値引"]);
  return {
    shippingFee: shippingSignal.value,
    pointValue: pointSignal.value,
    couponValue: couponSignal.value,
    conditionLabels: [
      shippingSignal.conditionRequired ? "送料条件あり" : "",
      pointSignal.conditionRequired ? "ポイント条件あり" : "",
      couponSignal.conditionRequired ? "クーポン条件あり" : "",
    ].filter(Boolean),
    evidence: [
      typeof shippingSignal.value === "number" ? `shipping fee from JSON-LD: ${shippingSignal.value.toLocaleString("ja-JP")} JPY` : "",
      shippingSignal.conditionRequired ? "shipping condition requires retailer confirmation" : "",
      pointSignal.value ? `point value from JSON-LD: ${pointSignal.value.toLocaleString("ja-JP")} JPY` : "",
      pointSignal.conditionRequired ? "point condition requires retailer confirmation" : "",
      couponSignal.value ? `coupon value from JSON-LD: ${couponSignal.value.toLocaleString("ja-JP")} JPY` : "",
      couponSignal.conditionRequired ? "coupon condition requires retailer confirmation" : "",
    ].filter(Boolean),
  };
}

function extractEmbeddedAdjustments(record: Record<string, unknown>): PriceAdjustments {
  const shippingSignal = extractFirstShippingForKeys(record, ["shippingFee", "shipping", "postage", "deliveryFee"]);
  const pointSignal = extractFirstRewardForKeys(
    record,
    ["pointValue", "pointAmount", "points", "rewardPoint"],
    ["point", "points", "ポイント"],
  );
  const couponSignal = extractFirstRewardForKeys(
    record,
    ["couponValue", "couponAmount", "coupon", "discount", "discountAmount"],
    ["coupon", "discount", "off", "クーポン", "値引"],
  );
  return {
    shippingFee: shippingSignal.value,
    pointValue: pointSignal.value,
    couponValue: couponSignal.value,
    conditionLabels: [
      shippingSignal.conditionRequired ? "送料条件あり" : "",
      pointSignal.conditionRequired ? "ポイント条件あり" : "",
      couponSignal.conditionRequired ? "クーポン条件あり" : "",
    ].filter(Boolean),
    evidence: [
      typeof shippingSignal.value === "number"
        ? `shipping fee from embedded JSON: ${shippingSignal.value.toLocaleString("ja-JP")} JPY`
        : "",
      shippingSignal.conditionRequired ? "shipping condition requires retailer confirmation" : "",
      pointSignal.value ? `point value from embedded JSON: ${pointSignal.value.toLocaleString("ja-JP")} JPY` : "",
      pointSignal.conditionRequired ? "point condition requires retailer confirmation" : "",
      couponSignal.value ? `coupon value from embedded JSON: ${couponSignal.value.toLocaleString("ja-JP")} JPY` : "",
      couponSignal.conditionRequired ? "coupon condition requires retailer confirmation" : "",
    ].filter(Boolean),
  };
}

function extractJsonLdShippingSignal(value: unknown): RewardSignal {
  if (hasIncludedShippingCopy(stringifyRewardPayload(value))) return { value: 0 };
  if (hasConditionalShippingCopy(stringifyRewardPayload(value))) return { conditionRequired: true };
  const amount = extractJsonLdAmount(value, ["shippingRate", "price", "value", "amount"]);
  return typeof amount === "number" ? { value: amount } : {};
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

function extractAdditionalPropertyReward(record: Record<string, unknown>, labels: string[]): RewardSignal {
  const properties = [record.additionalProperty, record.additionalProperties, record.priceSpecification].filter(Boolean);
  const parentDescriptor = stringifyRewardPayload(record);
  for (const property of properties) {
    const found = findNamedReward(property, labels, parentDescriptor);
    if (found.value || found.conditionRequired) return found;
  }
  return {};
}

function findNamedReward(value: unknown, labels: string[], context = ""): RewardSignal {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNamedReward(item, labels, context);
      if (found.value || found.conditionRequired) return found;
    }
    return {};
  }

  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const name = String(record.name ?? record.propertyID ?? record["@type"] ?? "");
  if (labels.some((label) => name.toLowerCase().includes(label.toLowerCase()))) {
    const rawValue = record.value ?? record.price ?? record.amount;
    const descriptor = `${context} ${name} ${stringifyRewardPayload(record)}`;
    const windowState = getRewardWindowState(record);
    if (windowState === "inactive") return { conditionRequired: true };
    if (hasStructuredRewardConditionCopy(descriptor, labels)) return { conditionRequired: true };
    if (hasDateLikeRewardValue(rawValue)) return { conditionRequired: true };
    const amount = parseRewardAmount(rawValue);
    if (amount) return { value: amount, conditionRequired: windowState === "active" };
  }

  for (const nested of Object.values(record)) {
    const found = findNamedReward(nested, labels, `${context} ${stringifyRewardPayload(record)}`);
    if (found.value || found.conditionRequired) return found;
  }
  return {};
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

function extractFirstShippingForKeys(value: unknown, keys: string[]): RewardSignal {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstShippingForKeys(item, keys);
      if (found.value || found.conditionRequired) return found;
    }
    return {};
  }

  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  for (const [key, rawValue] of Object.entries(record)) {
    if (keys.some((candidate) => key.toLowerCase() === candidate.toLowerCase())) {
      const descriptor = `${key} ${stringifyRewardPayload(record)}`;
      if (hasIncludedShippingCopy(descriptor)) return { value: 0 };
      if (hasConditionalShippingCopy(descriptor)) return { conditionRequired: true };
      const amount = parseAmountPayload(rawValue);
      if (amount) return { value: amount };
    }
  }

  for (const nested of Object.values(record)) {
    const found = extractFirstShippingForKeys(nested, keys);
    if (found.value || found.conditionRequired) return found;
  }
  return {};
}

function extractFirstRewardForKeys(value: unknown, keys: string[], labels: string[]): RewardSignal {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstRewardForKeys(item, keys, labels);
      if (found.value || found.conditionRequired) return found;
    }
    return {};
  }

  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  for (const [key, rawValue] of Object.entries(record)) {
    if (keys.some((candidate) => key.toLowerCase() === candidate.toLowerCase())) {
      const descriptor = `${key} ${stringifyRewardPayload(record)}`;
      const windowState = getRewardWindowState(record);
      if (windowState === "inactive") return { conditionRequired: true };
      if (hasStructuredRewardConditionCopy(descriptor, labels)) return { conditionRequired: true };
      if (hasDateLikeRewardValue(rawValue)) return { conditionRequired: true };
      const amount = parseRewardAmountPayload(rawValue);
      if (amount) return { value: amount, conditionRequired: windowState === "active" };
    }
  }

  for (const nested of Object.values(record)) {
    const found = extractFirstRewardForKeys(nested, keys, labels);
    if (found.value || found.conditionRequired) return found;
  }
  return {};
}

function parseAmountPayload(value: unknown) {
  const direct = parsePrice(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return parsePrice(record.amount ?? record.value ?? record.price);
}

function parseRewardAmountPayload(value: unknown) {
  const direct = parseRewardAmount(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return parseRewardAmount(record.amount ?? record.value ?? record.price);
}

function hasDateLikeRewardValue(value: unknown) {
  if (typeof value === "string") return isDateLikeRewardText(value);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [record.amount, record.value, record.price].some((nested) => typeof nested === "string" && isDateLikeRewardText(nested));
}

function parseRewardAmount(value: unknown) {
  if (typeof value === "string" && isDateLikeRewardText(value)) return undefined;
  return parsePrice(value);
}

function isDateLikeRewardText(value: string) {
  return /(?:valid|expires?|through|until|期限|有効|終了|開始|期間).{0,24}[12][0-9]{3}[-/年][0-9]{1,2}[-/月][0-9]{1,2}|[12][0-9]{3}[-/年][0-9]{1,2}[-/月][0-9]{1,2}.{0,24}(?:valid|expires?|through|until|期限|有効|終了|開始|期間)/i.test(
    toHalfWidth(value),
  );
}

function collectStructuredText(value: unknown): string {
  if (Array.isArray(value)) return value.map(collectStructuredText).join(" ");
  if (!value || typeof value !== "object") return typeof value === "string" ? value : "";
  return Object.entries(value as Record<string, unknown>)
    .map(([key, nested]) => `${key} ${collectStructuredText(nested)}`)
    .join(" ");
}

function getRewardWindowState(value: unknown): "active" | "inactive" | undefined {
  const start = readFirstDateForKeys(value, ["validFrom", "startTime", "start", "startsAt", "availableFrom", "campaignStartTime"]);
  const end = readFirstDateForKeys(value, ["validThrough", "endTime", "end", "endsAt", "expiresAt", "availableThrough", "campaignEndTime"]);
  if (end && isPastDateTime(end)) return "inactive";
  if (start && isFutureDateTime(start)) return "inactive";
  if (start || end) return "active";
  return undefined;
}

function readFirstDateForKeys(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readFirstDateForKeys(item, keys);
      if (found) return found;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, rawValue] of Object.entries(record)) {
    if (!keys.some((candidate) => key.toLowerCase() === candidate.toLowerCase())) continue;
    if (typeof rawValue === "string" && Number.isFinite(Date.parse(rawValue))) return rawValue;
  }

  for (const nested of Object.values(record)) {
    const found = readFirstDateForKeys(nested, keys);
    if (found) return found;
  }
  return undefined;
}

function isPastDateTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time < Date.now();
}

function isFutureDateTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now();
}

function stringifyRewardPayload(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function isEmbeddedProductRecord(record: Record<string, unknown>) {
  const productKeys = ["name", "title", "productName", "itemName", "sku", "janCode"];
  const hasProductIdentity = productKeys.some((key) => typeof record[key] === "string" && String(record[key]).trim().length > 0);
  const currency = String(record.currency ?? record.priceCurrency ?? "").toUpperCase();
  return hasProductIdentity || currency === "JPY";
}

function extractMetaAdjustments(html: string): PriceAdjustments {
  const shippingFee = extractMetaAmount(html, ["shipping", "postage", "送料"]);
  const pointSignal = extractMetaReward(html, ["point", "points", "ポイント"]);
  const couponSignal = extractMetaReward(html, ["coupon", "discount", "off", "クーポン", "値引"]);
  return {
    shippingFee,
    pointValue: pointSignal.value,
    couponValue: couponSignal.value,
    conditionLabels: [
      pointSignal.conditionRequired ? "ポイント条件あり" : "",
      couponSignal.conditionRequired ? "クーポン条件あり" : "",
    ].filter(Boolean),
    evidence: [
      typeof shippingFee === "number" ? `shipping fee from meta tag: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
      pointSignal.value ? `point value from meta tag: ${pointSignal.value.toLocaleString("ja-JP")} JPY` : "",
      pointSignal.conditionRequired ? "point condition requires retailer confirmation" : "",
      couponSignal.value ? `coupon value from meta tag: ${couponSignal.value.toLocaleString("ja-JP")} JPY` : "",
      couponSignal.conditionRequired ? "coupon condition requires retailer confirmation" : "",
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

function extractMetaReward(html: string, keys: string[]): RewardSignal {
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of metaTags) {
    const content = matchContent(tag, /\bcontent=["']([^"']+)["']/i);
    const descriptor = [matchContent(tag, /\b(?:property|name|itemprop)=["']([^"']+)["']/i), content].filter(Boolean).join(" ");
    if (!keys.some((key) => descriptor.toLowerCase().includes(key.toLowerCase()))) continue;
    if (hasRewardConditionCopy(descriptor, keys)) return { conditionRequired: true };
    const amount = parsePrice(content);
    if (typeof amount === "number") return { value: amount };
  }
  return {};
}

function inferPriceAdjustments(html: string, listPrice: number): PriceAdjustments {
  const text = extractPlainText(html);
  const shippingConditionRequired = hasConditionalShippingCopy(text);
  const purchaseConditionRequired =
    hasPurchaseConditionCopy(text) || hasCartOnlyPriceCopy(text) || hasRestrictedPriceCopy(text);
  const shippingFee = extractShippingFeeFromText(text);
  const pointRewardValueSignal = hasRewardValueSignal(text, ["point", "points", "ポイント"]);
  const couponRewardValueSignal = hasRewardValueSignal(text, ["coupon", "discount", "off", "クーポン"]);
  const pointValue = extractPointValue(text, listPrice);
  const couponValue = extractCouponValue(text, listPrice);
  const pointRewardAmountTooLarge = hasOversizedRewardAmount(text, ["point", "points"], listPrice, 0.35);
  const couponRewardAmountTooLarge = hasOversizedRewardAmount(text, ["coupon", "discount", "off", "クーポン"], listPrice, 0.6);
  let pointConditionRequired =
    pointRewardValueSignal &&
    !pointValue &&
    (hasAmbiguousRewardCopy(text, ["point", "points", "ポイント"]) ||
      hasRewardMultiplierCopy(text, ["point", "points", "ポイント"]) ||
      hasRewardThresholdCopy(text, ["point", "points", "ポイント"]));
  let couponConditionRequired =
    couponRewardValueSignal &&
    !couponValue &&
    (hasAmbiguousRewardCopy(text, ["coupon", "discount", "off", "クーポン"]) ||
      hasRewardThresholdCopy(text, ["coupon", "discount", "off", "クーポン"]) ||
      hasCouponCodeConditionCopy(text) ||
      hasConditionalDiscountPriceCopy(text));
  pointConditionRequired = pointConditionRequired || (!pointValue && pointRewardAmountTooLarge);
  couponConditionRequired = couponConditionRequired || (!couponValue && couponRewardAmountTooLarge);
  return {
    shippingFee,
    pointValue,
    couponValue,
    conditionLabels: [
      shippingConditionRequired ? "送料条件あり" : "",
      purchaseConditionRequired ? "購入条件あり" : "",
      pointConditionRequired ? "ポイント条件あり" : "",
      couponConditionRequired ? "クーポン条件あり" : "",
    ].filter(Boolean),
    evidence: [
      typeof shippingFee === "number" ? `shipping fee from page text: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
      shippingConditionRequired ? "shipping condition requires retailer confirmation" : "",
      purchaseConditionRequired ? "purchase condition requires retailer confirmation" : "",
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

function hasOversizedRewardAmount(text: string, labels: string[], listPrice: number, maxRatio: number) {
  if (!listPrice) return false;
  const explicit = extractLargestRewardAmount(text, labels);
  return Boolean(explicit && explicit / listPrice > maxRatio);
}

function extractShippingFeeFromText(text: string) {
  if (hasIncludedShippingCopy(text)) return 0;
  if (hasCertainFreeShippingCopy(text)) return 0;
  if (hasConditionalShippingCopy(text)) return undefined;
  if (hasPaymentFeeCopy(text)) return undefined;
  return extractAmountAroundLabel(text, ["送料", "配送料", "配送", "shipping", "postage", "delivery"]);
}

function hasPaymentFeeCopy(text: string) {
  return /(?:cod|cash on delivery).{0,32}(?:fee|fees|charge|payment)|(?:fee|fees|charge|payment).{0,32}(?:cod|cash on delivery)/i.test(
    text,
  );
}

function hasCertainFreeShippingCopy(text: string) {
  return !hasConditionalShippingCopy(text) && /送料無料|送料\s*0|free shipping/i.test(text);
}

function hasIncludedShippingCopy(text: string) {
  return /(?:送料(?:込|込み|こみ)|送料込み価格|送料込価格|shipping\s+included|shipping\s+is\s+included|includes\s+shipping|postage\s+included|delivery\s+included)/i.test(
    text,
  );
}

function hasConditionalShippingCopy(text: string) {
  if (hasUnconfirmedShippingCopy(text)) return true;

  const shippingLabels = ["送料", "送料無料", "free shipping", "shipping", "postage", "delivery"];
  const conditionWords = [
    "送料無料ライン",
    "あと",
    "残り",
    "不足",
    "追加",
    "もう",
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
    "remaining",
    "short by",
    "add",
    "eligible",
    "membership",
    "members only",
    "prime",
    "subscription",
    "region",
    "checkout",
    "calculated",
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

function hasUnconfirmedShippingCopy(text: string) {
  return /(?:送料\s*(?:別|別途|未定|要確認|確認|有料)|別途\s*送料|送料は.{0,24}(?:確認|地域|離島|沖縄|北海道)|(?:地域|離島|沖縄|北海道).{0,24}送料|shipping\s*(?:not included|extra|varies|calculated|required)|plus shipping|calculated at checkout|delivery fee applies|additional shipping|varies by region)/i.test(
    text,
  );
}

function hasPurchaseConditionCopy(text: string) {
  const purchaseWords = [
    "初回",
    "初めて",
    "初回限定",
    "定期",
    "定期購入",
    "定期おトク便",
    "おトク便",
    "まとめ買い",
    "セット",
    "複数個",
    "2個",
    "3個",
    "箱買い",
    "ケース",
    "ケース価格",
    "first order",
    "first purchase",
    "first-time",
    "subscribe",
    "subscription",
    "subscribe & save",
    "buying",
    "or more",
    "bundle",
    "multi-pack",
    "multipack",
    "pack of",
    "set of",
    "case",
  ];
  return purchaseWords.some((word) => new RegExp(escapeRegExp(word), "i").test(text));
}

function hasRestrictedPriceCopy(text: string) {
  return /(?:会員(?:限定)?|メンバー(?:限定)?|アプリ(?:限定)?|LINE(?:限定)?|ログイン(?:限定)?|プレミアム(?:会員)?|カード会員|prime|member|members only|member-only|app only|app-only|login required|premium member|card member|eligible only)\s*(?:価格|特価|限定価格|割引価格|price|deal)?|(?:価格|特価|限定価格|割引価格|price|deal)\s*(?:会員(?:限定)?|メンバー(?:限定)?|アプリ(?:限定)?|LINE(?:限定)?|ログイン(?:限定)?|プレミアム(?:会員)?|カード会員|prime|member|members only|member-only|app only|app-only|login required|premium member|card member|eligible only)/i.test(
    text,
  );
}

function hasRestrictedAmazonOfferPriceCopy(text: string) {
  const normalized = text.replace(/\s+/g, " ");
  if (!hasRestrictedPriceCopy(normalized)) return false;
  return !/(?:free shipping|shipping|postage|delivery)\s+(?:with|for)?\s*(?:prime|member|membership)/i.test(normalized);
}

function hasCartOnlyPriceCopy(text: string) {
  return /(?:add\s+to\s+cart\s+to\s+see\s+(?:the\s+)?price|see\s+(?:the\s+)?price\s+in\s+(?:cart|basket)|price\s+(?:shown|revealed|available)\s+in\s+(?:cart|basket)|(?:cart|basket)[-\s]?only\s+(?:price|deal|discount)|(?:cart|basket)\s+price|checkout\s+price|price\s+(?:shown|revealed|available)\s+at\s+checkout|final\s+price\s+at\s+checkout|log\s+in\s+or\s+add\s+to\s+cart)/i.test(
    text,
  );
}

function hasAmbiguousRewardCopy(text: string, labels: string[]) {
  const ambiguousWords = [
    "最大",
    "上限",
    "抽選",
    "予定",
    "後日",
    "後日付与",
    "付与上限",
    "対象者限定",
    "対象商品",
    "対象店舗",
    "対象ストア",
    "期間限定",
    "キャンペーン",
    "特典",
    "ボーナス",
    "先着",
    "一部",
    "数量限定",
    "要エントリー",
    "エントリー",
    "ログイン",
    "要ログイン",
    "会員限定",
    "アプリ限定",
    "LINE限定",
    "PayPay",
    "LYP",
    "カード会員",
    "指定カード",
    "支払い方法",
    "決済",
    "レビュー投稿",
    "レビュー",
    "プレミアム会員",
    "初回限定",
    "初回",
    "獲得予定",
    "付与予定",
    "後日獲得",
    "次回",
    "次回購入",
    "次回使える",
    "次回利用",
    "ギフト券",
    "ストアクレジット",
    "up to",
    "max",
    "maximum",
    "cap",
    "capped",
    "limit",
    "limited to",
    "upper limit",
    "campaign",
    "limited time",
    "bonus",
    "rebate",
    "mail-in rebate",
    "rebate form",
    "claim required",
    "manual claim",
    "after approval",
    "after checkout",
    "post-purchase",
    "cashback pending",
    "login",
    "app only",
    "member",
    "card member",
    "premium member",
    "entry required",
    "eligible only",
    "select items",
    "selected items",
    "selected sellers",
    "participating stores",
    "participating sellers",
    "payment method",
    "card required",
    "review required",
    "write a review",
    "survey",
    "questionnaire",
    "referral",
    "refer a friend",
    "invite friend",
    "friend referral",
    "lottery",
    "limited quantity",
    "while supplies last",
    "members only",
    "requires",
    "first order",
    "first purchase",
    "new customer",
    "one-time",
    "next order",
    "next purchase",
    "future purchase",
    "store credit",
    "gift card",
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

function hasRewardConditionCopy(text: string, labels: string[]) {
  return hasAmbiguousRewardCopy(text, labels) || hasRewardMultiplierCopy(text, labels) || hasRewardThresholdCopy(text, labels);
}

function hasStructuredRewardConditionCopy(text: string, labels: string[]) {
  if (hasRewardConditionCopy(text, labels)) return true;
  if (hasPurchaseConditionCopy(text)) return true;
  if (/(?:rebate|mail-in rebate|rebate form|claim required|manual claim|after approval|after checkout|post-purchase)/i.test(text)) {
    return true;
  }
  return /(?:対象商品|対象店舗|対象ストア|対象者限定|要エントリー|エントリー|ログイン|会員限定|アプリ限定|LINE限定|カード会員|指定カード|支払い方法|決済|レビュー投稿|レビュー|先着|一部|数量限定|eligible only|selected items|selected sellers|participating stores|participating sellers|payment method|card required|review required|write a review|lottery|limited quantity|while supplies last)/i.test(
    text,
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

function hasRewardValueSignal(text: string, labels: string[]) {
  return Boolean(extractLargestRewardAmount(text, labels) || labels.some((label) => extractRateAroundLabel(text, [label])));
}

function extractLargestRewardAmount(text: string, labels: string[]) {
  const normalized = toHalfWidth(text);
  let largest: number | undefined;

  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`${escaped}[^0-9０-９]{0,24}(?:¥|￥|JPY)?\\s*([0-9０-９][0-9０-９,，]*)`, "ig"),
      new RegExp(`(?:¥|￥|JPY)?\\s*([0-9０-９][0-9０-９,，]*)[^0-9０-９]{0,24}${escaped}`, "ig"),
    ];

    for (const pattern of patterns) {
      for (const match of normalized.matchAll(pattern)) {
        const raw = match[1];
        if (!raw) continue;

        const amount = parsePrice(raw);
        if (!amount) continue;

        const tokenStart = (match.index ?? 0) + match[0].indexOf(raw);
        if (isLikelyDateAmount(raw, tokenStart, normalized)) continue;

        largest = largest === undefined ? amount : Math.max(largest, amount);
      }
    }
  }

  return largest;
}

function isLikelyDateAmount(raw: string, tokenStart: number, normalized: string) {
  if (!/^\d{4}$/.test(raw)) return false;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1900 || value > 3000) return false;

  const next = normalized[tokenStart + raw.length];
  const previous = normalized[tokenStart - 1];
  return /[-/年月日]/.test(next) || /[-/年月日]/.test(previous);
}

function hasRewardThresholdCopy(text: string, labels: string[]) {
  const conditionWords = [
    "以上",
    "未満",
    "対象",
    "条件",
    "購入",
    "まとめ買い",
    "利用",
    "併用",
    "取得",
    "獲得",
    "入力",
    "コード",
    "クーポンコード",
    "事前取得",
    "税込",
    "when",
    "if",
    "buy",
    "buying",
    "purchase",
    "spend",
    "orders over",
    "minimum",
    "or more",
    "with",
    "cannot be combined",
    "coupon code",
    "promo code",
    "code required",
    "enter code",
    "apply code",
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

function hasCouponCodeConditionCopy(text: string) {
  return /(?:クーポン(?:コード)?|プロモ(?:コード)?|割引コード|coupon\s+code|promo\s+code|promotion\s+code|discount\s+code).{0,40}(?:適用|入力|利用|取得|対象|条件|required|apply|applied|enter|with)|(?:適用|入力|利用|取得|対象|条件|required|apply|applied|enter|with).{0,40}(?:クーポン(?:コード)?|プロモ(?:コード)?|割引コード|coupon\s+code|promo\s+code|promotion\s+code|discount\s+code)/i.test(
    text,
  );
}

function hasConditionalDiscountPriceCopy(text: string) {
  return /(?:クーポン|プロモ|割引|coupon|promo|promotion|discount).{0,80}(?:適用後|適用|利用後|取得後|対象|条件|after|applied|clipped|clip|with|required)|(?:適用後|適用|利用後|取得後|対象|条件|after|applied|clipped|clip|with|required).{0,80}(?:クーポン|プロモ|割引|coupon|promo|promotion|discount)/i.test(
    text,
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
  if (isDateLikePriceValue(value)) return undefined;
  const normalized = toHalfWidth(value)
    .replace(/[,，]/g, "")
    .match(/[0-9]+(?:\.[0-9]+)?/)?.[0];
  const price = normalized ? Number(normalized) : NaN;
  return Number.isFinite(price) ? Math.round(price) : undefined;
}

function isDateLikePriceValue(value: string) {
  const normalized = toHalfWidth(value).trim();
  return /(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\b|\s|$)|\d{4}[-/]\d{1,2}(?:\b|\s|$))/.test(
    normalized,
  );
}

function isUnitPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(index + length, index + length + 28);
  return (
    /(?:\/|／|per\s*)\s*(?:100)?\s*(?:g|kg|ml|l|個|枚|本|袋|回)/i.test(after) ||
    /(?:100\s*)?(?:g|kg|ml|l|個|枚|本|袋|回)\s*(?:あたり|当たり|単価)\s*$/i.test(before)
  );
}

function isPackComponentPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(index + length, index + length + 36);
  return (
    /(?:単品|1\s*(?:個|枚|本|袋|箱)|一\s*(?:個|枚|本|袋|箱))\s*$/i.test(before) ||
    /^\s*(?:x|×|✕|\*)\s*[0-9０-９]+\s*(?:個|枚|本|袋|箱|ケース|セット|pack|packs|pcs|pieces|count)/i.test(after) ||
    /^\s*(?:for|each in)\s*[0-9０-９]+\s*(?:pack|packs|pcs|pieces|count)/i.test(after)
  );
}

function isSampleTrialPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 36), index);
  const after = text.slice(index + length, index + length + 36);
  const sampleWords = /(?:sample|trial|tester|mini\s*size|travel\s*size|sample[-\s]?size|trial[-\s]?size)\s*(?:price|deal)?\s*$/i;
  const sampleAfter = /^\s*(?:sample|trial|tester|mini\s*size|travel\s*size|sample[-\s]?size|trial[-\s]?size)(?:\s*(?:price|deal))?/i;
  return sampleWords.test(before) || sampleAfter.test(after);
}

function isAdditionalItemPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 36), index);
  const after = text.slice(index + length, index + length + 40);
  const matchedText = text.slice(index, index + length);
  const ordinalItem = /(?:[2２二]\s*(?:点|個|枚|本|袋|箱|品)\s*目|second\s+item|2nd\s+item|additional\s+item|extra\s+item)/i;
  const conditionalPriceWords = /(?:半額|無料|割引|値引|特価|価格|off|discount|deal|price)/i;
  const beforeTail = before.slice(-28);
  const ordinalMatch = beforeTail.match(ordinalItem);
  const afterOrdinal = ordinalMatch ? beforeTail.slice((ordinalMatch.index ?? 0) + ordinalMatch[0].length) : "";
  const hasInterveningPrice = /(?:¥|￥)\s*[0-9０-９]|[0-9０-９][0-9０-９,，]*\s*(?:円|JPY)/i.test(afterOrdinal);
  return (
    (Boolean(ordinalMatch) &&
      !hasInterveningPrice &&
      (conditionalPriceWords.test(beforeTail) || conditionalPriceWords.test(afterOrdinal) || conditionalPriceWords.test(matchedText))) ||
    (Boolean(ordinalMatch) && !hasInterveningPrice && /^\s*(?:円|JPY)?\s*(?:なら|で|only|each)/i.test(after)) ||
    /^\s*(?:なら|で|for|as)\s*(?:the\s*)?(?:second\s+item|2nd\s+item|additional\s+item|extra\s+item|[2２二]\s*(?:点|個|枚|本|袋|箱|品)\s*目)/i.test(
      after,
    )
  );
}

function isRangeLowerBoundPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 28), index);
  const after = text.slice(index + length, index + length + 28);
  return (
    /(?:から|より|from|as low as|starting at|starts? from|lowest(?:\s+price)?|minimum(?:\s+price)?|バリエーション|variant)\s*$/i.test(
      before,
    ) || /^\s*(?:〜|～|から|より|and up|\+|or more|以上|バリエーション|variant)/i.test(after)
  );
}

function isEffectivePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 28);
  const labelBefore =
    /(?:実質|実質価格|還元後|割引後|クーポン適用後|ポイント還元後|effective|net price|after rewards?|after points?|after coupon)\s*$/i;
  const labelAfter =
    /^\s*(?:実質|実質価格|還元後|割引後|クーポン適用後|ポイント還元後|effective|net price|after rewards?|after points?|after coupon)/i;
  return labelBefore.test(before) || labelAfter.test(after);
}

function isInstallmentAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 32), index);
  const after = text.slice(index + length, index + length + 36);
  const labelBefore =
    /(?:月々|月額|毎月|分割|ローン|あと払い|リボ|installments?|installment|monthly|per month|per mo\.?|payment plan|financing)\s*$/i;
  const labelAfter =
    /^\s*(?:\/\s*(?:月|mo|month)|ずつ|から|の分割|分割|月額|毎月|per month|per mo\.?|monthly|installments?|payment plan|financing)/i;
  return labelBefore.test(before) || labelAfter.test(after);
}

function isCartOnlyPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 54), index);
  const after = text.slice(index + length, index + length + 42);
  const context = `${before} ${text.slice(index, index + length)} ${after}`;
  return hasCartOnlyPriceCopy(context);
}

function isNonProductFeeAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 30), index);
  const after = text.slice(index + length, index + length + 26);
  const feeWords =
    /(?:代引|決済|支払|支払い|事務|取扱|取扱い|手数料|保証金|預り金|預かり金|デポジット|deposit|security deposit|fee|fees|handling|processing|payment|cod|cash on delivery|warranty|insurance|protection plan|gift wrap|gift wrapping|wrapping|rental|lease|repair service|restocking|return shipping)\s*$/i;
  const feeAfter =
    /^\s*(?:の)?\s*(?:手数料|保証金|預り金|預かり金|デポジット|deposit|security deposit|fee|fees|handling|processing|warranty|insurance|protection plan|gift wrap|gift wrapping|wrapping|rental|lease|repair service|restocking|return shipping)/i;
  const paymentFeeAfter = /^\s*(?:payment|cod|cash on delivery)/i.test(after);
  return feeWords.test(before) || feeAfter.test(after) || paymentFeeAfter;
}

function isDiscountAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 28);
  const nearestBeforeToken = before.trimEnd().match(/(?:^|\s)(\S{0,24})$/)?.[1] ?? "";
  const matchedText = text.slice(index, index + length);
  const labelPrefix = `${nearestBeforeToken}${matchedText.replace(/[0-9０-９].*$/, "")}`;
  const englishSavingsWords = /(?:save|savings)\s*$/i;
  const words = /(?:クーポン|値引き|値引|割引|割引額|off|discount|coupon|cashback)/i;
  return (
    englishSavingsWords.test(labelPrefix) ||
    words.test(labelPrefix) ||
    /^\s*(?:OFF|off|引き|値引き|値引|割引|割引額|discount|cashback|save|savings)(?:\b|$)/i.test(after) ||
    (/円\s*$/i.test(matchedText) && /^\s*クーポン/.test(after))
  );
}

function isCouponAppliedPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 42), index);
  const after = text.slice(index + length, index + length + 36);
  const beforeTail = before.slice(-36);
  const couponAppliedBefore =
    /(?:クーポン(?:コード)?|プロモ(?:コード)?|割引コード|coupon(?:\s+code)?|promo(?:\s+code)?|promotion code|discount code).{0,20}(?:適用後|適用|入力後|利用後|after|applied|with)\s*(?:価格|price|deal)?\s*$/i;
  const couponAppliedAfter =
    /^\s*(?:の)?\s*(?:クーポン(?:コード)?|プロモ(?:コード)?|割引コード|coupon(?:\s+code)?|promo(?:\s+code)?|promotion code|discount code).{0,20}(?:適用後|適用|入力後|利用後|after|applied|with)\s*(?:価格|price|deal)?/i;
  const clippedDiscountBefore =
    /(?:coupon|promo|promotion|discount).{0,32}(?:after|applied|clipped|clip|with|required)\s*(?:price|deal)?\s*$/i;
  return couponAppliedBefore.test(beforeTail) || couponAppliedAfter.test(after) || clippedDiscountBefore.test(beforeTail);
}

function isRewardAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 28), index);
  const after = text.slice(index + length, index + length + 28);
  const nearestBeforeToken = before.trimEnd().match(/(?:^|\s)(\S{0,28})$/)?.[1] ?? "";
  const labelPrefix = `${nearestBeforeToken}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  if (
    /(?:survey|questionnaire|referral|refer a friend|invite friend|friend referral)\s*$/i.test(before) ||
    /(?:survey|questionnaire|referral|refer a friend|invite friend|friend referral)/i.test(labelPrefix) ||
    /^\s*(?:survey|questionnaire|referral|refer a friend|invite friend|friend referral)(?:\b|$)/i.test(after)
  ) {
    return true;
  }
  const words =
    /(?:ポイント|還元|付与|獲得|PayPay|楽天ポイント|ギフト券|商品券|ストアクレジット|次回使える|次回購入|point|points|reward|cashback|gift card|gift certificate|voucher|store credit|next order|next purchase)/i;
  const rewardLabelBefore =
    /(?:ポイント|還元|付与|獲得|PayPay|楽天ポイント|ギフト券|商品券|ストアクレジット|次回使える|次回購入|point|points|reward|cashback|gift card|gift certificate|voucher|store credit|next order|next purchase)\s*$/i;
  return words.test(labelPrefix) || rewardLabelBefore.test(before) || /^\s*(?:分|相当|pt|pts)(?:\b|$)/i.test(after);
}

function isConditionThresholdAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 48);
  const cappedBefore =
    /(?:point|points|reward|coupon|discount|savings).{0,40}(?:up to|max(?:imum)?|cap(?:ped)?|limit(?:ed to)?|upper limit).{0,12}$/i.test(
      before,
    );
  const cappedAfter = /^\s*(?:max(?:imum)?|cap(?:ped)?|limit(?:ed to)?|upper limit)\b/i.test(after);
  if ((cappedBefore || cappedAfter) && /(?:point|points|reward|coupon|discount|savings)/i.test(`${before}${after}`)) {
    return true;
  }
  const thresholdAfter = /^\s*(?:以上|未満|から|より|or more|and up|minimum|over|above|\+)/i.test(after);
  const conditionNearby = /(?:クーポン|coupon|割引|discount|off|送料無料|free shipping|送料|対象|条件|購入|注文|order|eligible)/i.test(
    `${before}${after}`,
  );
  return thresholdAfter && conditionNearby;
}

function isFreeShippingProgressAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 36);
  const progressBefore = /(?:あと|残り|不足|追加|もう|add|remaining|short by)\s*$/i.test(before);
  const freeShippingAfter = /^\s*(?:で|追加で|more for|to|until)?\s*(?:送料無料|free shipping)/i.test(after);
  return progressBefore && freeShippingAfter;
}

function isStandaloneShippingFeeAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 44), index);
  const after = text.slice(index + length, index + length + 36);
  const shippingFeeBefore =
    /(?:送料|配送料|配送(?:料)?|発送(?:料)?|shipping|postage|delivery|freight).{0,18}(?:fee|fees|charge|charges|cost|costs|amount|別|別途|有料)?\s*$/i;
  const shippingFeeAfter =
    /^\s*(?:の)?\s*(?:送料|配送料|配送(?:料)?|発送(?:料)?|shipping|postage|delivery|freight).{0,18}(?:fee|fees|charge|charges|cost|costs|amount)?/i;
  return shippingFeeBefore.test(before) || shippingFeeAfter.test(after);
}

function isShippingConditionAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 36), index);
  const after = text.slice(index + length, index + length + 24);
  const hasShippingLabelBefore = /(?:送料無料ライン|送料無料|送料|shipping|postage|delivery|free shipping)/i.test(before);
  const hasConditionWordBefore = /(?:以上|未満|条件|対象|ライン|over|above|minimum|orders?\s+over|threshold|eligible)\s*$/i.test(before);
  const hasConditionWordAfter = /^\s*(?:以上|未満|条件|対象|ライン|or more|over|above|minimum|threshold|eligible)/i.test(after);
  return hasShippingLabelBefore && (hasConditionWordBefore || hasConditionWordAfter);
}

function isTaxExcludedContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 32), index);
  const after = text.slice(index + length, index + length + 18);
  const labelBefore = before.replace(/^.*[0-9０-９][^0-9０-９]*/, "");
  const prePriceLabel = /^(?:円|yen|JPY)\b/i.test(labelBefore.trim()) ? "" : labelBefore;
  return (
    /(?:税抜(?:価格)?|税別(?:価格)?|本体価格|excluding tax|tax excluded|tax not included|excl\.?\s*tax)\s*[:：-]?\s*$/i.test(
      prePriceLabel,
    ) ||
    /^\s*(?:税抜(?:価格)?|税別(?:価格)?|\+税|＋税|税別途|excluding tax|tax excluded|tax not included|excl\.?\s*tax)/i.test(after) ||
    /^\s*(?:\(|（|\[|【)?\s*(?:税抜(?:価格)?|税別(?:価格)?|本体価格|\+税|＋税|税別途|excluding tax|tax excluded|tax not included|excl\.?\s*tax)/i.test(
      after,
    )
  );
}

function isReferencePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 22), index);
  const after = text.slice(index + length, index + length + 18);
  const labelPrefix = `${before.replace(/^.*[0-9０-９][^0-9０-９]*/, "")}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  const referenceWords =
    /(?:通常価格|参考価格|メーカー希望小売価格|定価|list price|regular price|was price|original price|msrp|rrp|manufacturer(?:'s)? suggested retail price)\s*[:：-]?\s*$/i;
  return (
    referenceWords.test(labelPrefix) ||
    referenceWords.test(before) ||
    /^\s*(?:通常価格|参考価格|メーカー希望小売価格|定価|list price|regular price|was price|original price|msrp|rrp|manufacturer(?:'s)? suggested retail price)/i.test(
      after,
    )
  );
}

function isExpiredSalePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 36), index);
  const after = text.slice(index + length, index + length + 30);
  const labelPrefix = `${before.replace(/^.*[0-9０-９][^0-9０-９]*/, "")}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  const words =
    /(?:終了|終了済み|過去価格|旧価格|セール終了|タイムセール終了|期限切れ|販売終了価格|expired|ended|previous sale|past price|old price|deal ended|sale ended)\s*$/i;
  const wordsAfter =
    /^\s*(?:終了|終了済み|過去価格|旧価格|セール終了|タイムセール終了|期限切れ|販売終了価格|expired|ended|previous sale|past price|old price|deal ended|sale ended)/i;
  return words.test(labelPrefix) || words.test(before) || wordsAfter.test(after);
}

function isUsedConditionPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 32), index);
  const after = text.slice(index + length, index + length + 26);
  const labelPrefix = `${before.replace(/^.*[0-9０-９][^0-9０-９]*/, "")}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  const words =
    /(?:中古|中古品|訳あり|アウトレット|開封済み|展示品|再生品|箱潰れ|箱つぶれ|used|pre-owned|preowned|open box|open-box|outlet|refurbished|renewed|damaged box)\s*$/i;
  const wordsAfter =
    /^\s*(?:中古|中古品|訳あり|アウトレット|開封済み|展示品|再生品|箱潰れ|箱つぶれ|used|pre-owned|preowned|open box|open-box|outlet|refurbished|renewed|damaged box)/i;
  return words.test(labelPrefix) || words.test(before) || wordsAfter.test(after);
}

function hasUsedConditionCopy(text: string) {
  return /(?:中古|中古品|訳あり|アウトレット|開封済み|展示品|再生品|箱潰れ|箱つぶれ|used|pre-owned|preowned|open box|open-box|outlet|refurbished|renewed|damaged box|UsedCondition|RefurbishedCondition|DamagedCondition)/i.test(
    text,
  );
}

function hasSampleTrialProductCopy(text: string) {
  return /(?:\bsample[-\s]?(?:size|trial|tester|pack|item|product)?\b|\btrial[-\s]?(?:size|pack|item|product)?\b|\btester\b|\bmini\s*size\b|\btravel\s*size\b|\btry\s*me\s*size\b|\u30b5\u30f3\u30d7\u30eb|\u304a\u8a66\u3057|\u8a66\u4f9b\u54c1|\u30c6\u30b9\u30bf\u30fc|\u30df\u30cb\u30b5\u30a4\u30ba|\u30c8\u30e9\u30d9\u30eb\u30b5\u30a4\u30ba)/i.test(
    text,
  );
}

function hasUnavailableConditionCopy(text: string) {
  return /(?:在庫なし|売り切れ|売切れ|完売|販売終了|品切れ|入荷待ち|入荷予定|予約販売|予約受付|発売前|販売前|sold\s*out|soldout|out\s*of\s*stock|outofstock|out[_-]of[_-]stock|unavailable|discontinued|pre-?order|coming soon|not yet available)/i.test(
    text,
  );
}

function isUnavailablePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 44), index);
  const after = text.slice(index + length, index + length + 24);
  const labelPrefix = `${before.replace(/^.*[0-9０-９][^0-9０-９]*/, "")}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  const wordsBefore =
    /(?:在庫なし|売り切れ|売切れ|販売終了|入荷待ち|入荷予定|品切れ|予約価格|予約販売|予約受付|発売前|販売前|sold\s*out|soldout|out\s*of\s*stock|outofstock|out[_-]of[_-]stock|unavailable|discontinued|pre-?order|coming soon|not yet available)\s*$/i;
  return hasUnavailableConditionCopy(labelPrefix) || wordsBefore.test(before) || hasUnavailableConditionCopy(after);
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
