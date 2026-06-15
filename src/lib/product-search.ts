import { buildEffectivePriceQuote, buildMarketplaceSearchUrls } from "./post-mvp";
import type { ProductSearchCandidate, ProductSearchResult } from "./types";

const MAX_HTML_BYTES = 1_500_000;
const USER_AGENT = "HomeStackPriceRadar/0.1 (+https://github.com/TMluku/Home-stack)";

type SearchSourceReport = ProductSearchResult["sources"][number];
type RawCandidate = Omit<ProductSearchCandidate, "id" | "matchScore" | "confidence" | "fetchedAt">;
type MarketplaceSearchSource = "rakuten" | "yahoo-shopping";
type OfficialApiRecord = Record<string, unknown>;

const SOURCE_LABELS = {
  rakuten: "楽天市場",
  "yahoo-shopping": "Yahoo!ショッピング",
  "direct-url": "指定URL",
};

export async function searchProductPrices(query: string): Promise<ProductSearchResult> {
  const normalizedQuery = normalizeQuery(query);
  const searchedAt = new Date().toISOString();

  if (!normalizedQuery) {
    return { query, normalizedQuery, searchedAt, candidates: [], sources: [] };
  }

  const [rakuten, yahoo] = await Promise.all([searchRakuten(normalizedQuery), searchYahooShopping(normalizedQuery)]);
  const marketplaceLinks = buildLiveMarketplaceLinkCandidates(normalizedQuery);
  const sources = [
    rakuten.report,
    yahoo.report,
    {
      source: "marketplace-link" as const,
      label: "外部検索リンク",
      ok: marketplaceLinks.length > 0,
      searchedUrl: "",
      count: marketplaceLinks.length,
    },
  ];
  const candidates = rankCandidates([...rakuten.candidates, ...yahoo.candidates, ...marketplaceLinks], normalizedQuery, searchedAt);

  return {
    query,
    normalizedQuery,
    searchedAt,
    candidates: candidates.slice(0, 12),
    sources,
  };
}

function buildLiveMarketplaceLinkCandidates(query: string): RawCandidate[] {
  return buildMarketplaceSearchUrls(query)
    .filter((source) => source.label.includes("Amazon"))
    .map((source) => ({
      source: "marketplace-link",
      sourceLabel: source.label,
      title: `${source.label}で ${query} を検索`,
      url: source.url,
      currency: "JPY",
      shipping: "価格・送料条件は販売サイトで確認",
      evidence: ["external marketplace search link", "Amazonは商品ページまたは検索結果から価格条件を確認"],
    }));
}

export function extractSearchCandidatesFromHtml(html: string, source: MarketplaceSearchSource, baseUrl: string): RawCandidate[] {
  const decoded = decodeEntities(html);
  const snippets = splitIntoProductSnippets(decoded);

  const candidates: Array<RawCandidate | null> = snippets.map((snippet) => {
    const url = extractProductUrl(snippet, baseUrl);
    const price = extractPrice(snippet);
    const title = extractTitle(snippet);
    if (!url || !title || !price) return null;
    const adjustments = inferPriceAdjustments(snippet, price);

    return {
      source,
      sourceLabel: SOURCE_LABELS[source],
      title,
      url,
      price,
      effectivePriceQuote: appendConditionLabels(
        buildEffectivePriceQuote({
          listPrice: price,
          shippingFee: adjustments.shippingFee,
          pointValue: adjustments.pointValue,
          couponValue: adjustments.couponValue,
        }),
        adjustments.conditionLabels,
      ),
      currency: "JPY",
      shipping: adjustments.shippingLabel,
      imageUrl: extractImageUrl(snippet, baseUrl),
      evidence: [SOURCE_LABELS[source], "検索結果HTMLから商品名・価格・リンクを抽出", ...adjustments.evidence],
    };
  });

  return candidates
    .filter((candidate): candidate is RawCandidate => Boolean(candidate))
    .filter(dedupeByUrl)
    .slice(0, 8);
}

function normalizeQuery(query: string) {
  return query.replace(/\s+/g, " ").trim();
}

async function searchRakuten(query: string): Promise<{ candidates: RawCandidate[]; report: SearchSourceReport }> {
  const apiResult = await searchRakutenApi(query);
  if (apiResult) return apiResult;

  const searchedUrl = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/`;
  return searchHtmlSource("rakuten", searchedUrl);
}

async function searchRakutenApi(query: string): Promise<{ candidates: RawCandidate[]; report: SearchSourceReport } | null> {
  const applicationId = process.env.RAKUTEN_APPLICATION_ID;
  if (!applicationId) return null;

  const searchedUrl = new URL("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601");
  searchedUrl.searchParams.set("applicationId", applicationId);
  searchedUrl.searchParams.set("keyword", query);
  searchedUrl.searchParams.set("hits", "8");
  searchedUrl.searchParams.set("format", "json");

  try {
    const response = await fetchText(searchedUrl.toString(), "application/json");
    const payload = JSON.parse(response) as {
      Items?: Array<{
        Item?: {
          itemName?: string;
          itemPrice?: number;
          itemUrl?: string;
          mediumImageUrls?: Array<{ imageUrl?: string }>;
          postageFlag?: number;
          pointRate?: number;
          pointRateStartTime?: string;
          pointRateEndTime?: string;
          couponAmount?: number;
          couponValue?: number;
          couponRate?: number;
          couponStartTime?: string;
          couponEndTime?: string;
        };
      }>;
    };
    const candidates: RawCandidate[] =
      payload.Items?.map((entry) => entry.Item)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item): RawCandidate => {
          const signals = buildOfficialPriceSignals(item as OfficialApiRecord, item.itemPrice ?? 0, "rakuten");

          return {
            source: "rakuten",
            sourceLabel: SOURCE_LABELS.rakuten,
            title: item.itemName ?? "",
            url: item.itemUrl ?? "",
            price: item.itemPrice,
            effectivePriceQuote: appendConditionLabels(
              buildEffectivePriceQuote({
                listPrice: item.itemPrice ?? 0,
                shippingFee: signals.shippingFee,
                pointValue: signals.pointValue,
                couponValue: signals.couponValue,
              }),
              signals.conditionLabels,
            ),
            currency: "JPY",
            shipping: signals.shippingLabel,
            imageUrl: item.mediumImageUrls?.[0]?.imageUrl?.replace(/\?_ex=\d+x\d+$/, ""),
            evidence: ["楽天市場公式API", "商品名・価格・商品URLをAPIレスポンスから取得", ...signals.evidence],
          };
        })
        .filter((candidate) => candidate.title && candidate.url && candidate.price) ?? [];

    return {
      candidates,
      report: { source: "rakuten", label: SOURCE_LABELS.rakuten, ok: true, searchedUrl: searchedUrl.toString(), count: candidates.length },
    };
  } catch (error) {
    return {
      candidates: [],
      report: {
        source: "rakuten",
        label: SOURCE_LABELS.rakuten,
        ok: false,
        searchedUrl: searchedUrl.toString(),
        error: error instanceof Error ? error.message : "楽天API検索に失敗しました",
        count: 0,
      },
    };
  }
}

async function searchYahooShopping(query: string): Promise<{ candidates: RawCandidate[]; report: SearchSourceReport }> {
  const appId = process.env.YAHOO_SHOPPING_APP_ID;
  if (appId) {
    const apiResult = await searchYahooShoppingApi(query, appId);
    if (apiResult) return apiResult;
  }

  const searchedUrl = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(query)}`;
  return searchHtmlSource("yahoo-shopping", searchedUrl);
}

async function searchYahooShoppingApi(
  query: string,
  appId: string,
): Promise<{ candidates: RawCandidate[]; report: SearchSourceReport } | null> {
  const searchedUrl = new URL("https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch");
  searchedUrl.searchParams.set("appid", appId);
  searchedUrl.searchParams.set("query", query);
  searchedUrl.searchParams.set("results", "8");

  try {
    const response = await fetchText(searchedUrl.toString(), "application/json");
    const payload = JSON.parse(response) as {
      hits?: Array<{
        name?: string;
        url?: string;
        price?: number;
        image?: { medium?: string };
        shipping?: { code?: number; name?: string };
        point?: { amount?: number; startTime?: string; endTime?: string };
        coupon?: { amount?: number; value?: number; rate?: number; startTime?: string; endTime?: string };
        couponAmount?: number;
        couponValue?: number;
        discountAmount?: number;
      }>;
    };
    const candidates: RawCandidate[] =
      payload.hits
        ?.map((item): RawCandidate => {
          const signals = buildOfficialPriceSignals(item as OfficialApiRecord, item.price ?? 0, "yahoo-shopping");

          return {
            source: "yahoo-shopping",
            sourceLabel: SOURCE_LABELS["yahoo-shopping"],
            title: item.name ?? "",
            url: item.url ?? "",
            price: item.price,
            effectivePriceQuote: appendConditionLabels(
              buildEffectivePriceQuote({
                listPrice: item.price ?? 0,
                shippingFee: signals.shippingFee,
                pointValue: signals.pointValue,
                couponValue: signals.couponValue,
              }),
              signals.conditionLabels,
            ),
            currency: "JPY",
            shipping: item.shipping?.name ?? signals.shippingLabel,
            imageUrl: item.image?.medium,
            evidence: ["Yahoo!ショッピング公式API", "商品名・価格・商品URLをAPIレスポンスから取得", ...signals.evidence],
          };
        })
        .filter((candidate) => candidate.title && candidate.url && candidate.price) ?? [];

    return {
      candidates,
      report: {
        source: "yahoo-shopping",
        label: SOURCE_LABELS["yahoo-shopping"],
        ok: true,
        searchedUrl: searchedUrl.toString(),
        count: candidates.length,
      },
    };
  } catch (error) {
    return {
      candidates: [],
      report: {
        source: "yahoo-shopping",
        label: SOURCE_LABELS["yahoo-shopping"],
        ok: false,
        searchedUrl: searchedUrl.toString(),
        error: error instanceof Error ? error.message : "Yahoo!ショッピングAPI検索に失敗しました",
        count: 0,
      },
    };
  }
}

async function searchHtmlSource(
  source: MarketplaceSearchSource,
  searchedUrl: string,
): Promise<{ candidates: RawCandidate[]; report: SearchSourceReport }> {
  try {
    const html = await fetchText(searchedUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    const candidates = extractSearchCandidatesFromHtml(html, source, searchedUrl);
    return {
      candidates,
      report: { source, label: SOURCE_LABELS[source], ok: true, searchedUrl, count: candidates.length },
    };
  } catch (error) {
    return {
      candidates: [],
      report: {
        source,
        label: SOURCE_LABELS[source],
        ok: false,
        searchedUrl,
        error: error instanceof Error ? error.message : "検索結果の取得に失敗しました",
        count: 0,
      },
    };
  }
}

async function fetchText(url: string, accept: string) {
  const response = await fetch(url, {
    headers: {
      accept,
      "accept-language": "ja,en-US;q=0.8,en;q=0.6",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).slice(0, MAX_HTML_BYTES);
}

function rankCandidates(candidates: RawCandidate[], query: string, searchedAt: string): ProductSearchCandidate[] {
  return candidates
    .filter((candidate) => candidate.title && candidate.url)
    .filter(dedupeByUrl)
    .map((candidate, index) => {
      const matchScore = calculateMatchScore(query, candidate.title);
      const confidence: ProductSearchCandidate["confidence"] = matchScore >= 72 ? "high" : matchScore >= 45 ? "medium" : "low";
      return {
        ...candidate,
        id: `${candidate.source}-${index}-${hashText(candidate.url)}`,
        matchScore,
        confidence,
        fetchedAt: searchedAt,
      };
    })
    .sort(
      (a, b) =>
        (a.effectivePriceQuote?.effectivePrice ?? a.price ?? Number.MAX_SAFE_INTEGER) -
          (b.effectivePriceQuote?.effectivePrice ?? b.price ?? Number.MAX_SAFE_INTEGER) || b.matchScore - a.matchScore,
    );
}

function splitIntoProductSnippets(html: string) {
  const anchors = [...html.matchAll(/<a\b[\s\S]*?<\/a>/gi)].map((match) => match[0]);
  const largerBlocks = [...html.matchAll(/<(?:li|article|div)\b[\s\S]{0,5000}?<\/(?:li|article|div)>/gi)].map((match) => match[0]);
  return [...largerBlocks, ...anchors].filter((snippet) => /(?:¥|￥|円|JPY|price|itemPrice)/i.test(snippet));
}

function extractProductUrl(snippet: string, baseUrl: string) {
  const href = snippet.match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) return undefined;
  try {
    const url = new URL(decodeEntities(href), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function extractTitle(snippet: string) {
  const candidates = [
    snippet.match(/(?:title|aria-label|alt)=["']([^"']{4,160})["']/i)?.[1],
    snippet.match(/<h\d[^>]*>([\s\S]{4,200}?)<\/h\d>/i)?.[1],
    snippet.match(/<a\b[^>]*>([\s\S]{4,220}?)<\/a>/i)?.[1],
  ];

  return candidates.map((candidate) => cleanText(candidate)).find((candidate) => candidate && !/^\d[\d,]*円?$/.test(candidate));
}

function extractImageUrl(snippet: string, baseUrl: string) {
  const src = snippet.match(/(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/i)?.[1];
  if (!src) return undefined;
  try {
    return new URL(decodeEntities(src), baseUrl).toString();
  } catch {
    return undefined;
  }
}

function extractPrice(snippet: string) {
  const text = cleanText(snippet) ?? "";
  const pricePattern = /(?:¥|￥)\s*([0-9０-９][0-9０-９,，]*)|([0-9０-９][0-9０-９,，]*)\s*(?:円|JPY)/gi;
  for (const match of text.matchAll(pricePattern)) {
    if (isUnitPriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isPackComponentPriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isDiscountAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isTaxExcludedContext(text, match.index ?? 0, match[0].length)) continue;
    if (isReferencePriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isUnavailablePriceContext(text, match.index ?? 0, match[0].length)) continue;
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const price = Number(toHalfWidth(raw).replace(/[,，]/g, ""));
    if (Number.isFinite(price)) return price;
  }
  return undefined;
}

function inferPriceAdjustments(snippet: string, listPrice: number) {
  const text = cleanText(snippet) ?? "";
  const shippingConditionRequired = hasConditionalShippingCopy(text);
  const purchaseConditionRequired = hasPurchaseConditionCopy(text);
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
  const evidence = [
    typeof shippingFee === "number" ? `shipping fee inferred: ${shippingFee.toLocaleString("ja-JP")} JPY` : "",
    shippingConditionRequired ? "shipping condition requires retailer confirmation" : "",
    purchaseConditionRequired ? "purchase condition requires retailer confirmation" : "",
    pointValue ? `point value inferred: ${pointValue.toLocaleString("ja-JP")} JPY` : "",
    pointConditionRequired ? "point condition requires retailer confirmation" : "",
    couponValue ? `coupon value inferred: ${couponValue.toLocaleString("ja-JP")} JPY` : "",
    couponConditionRequired ? "coupon condition requires retailer confirmation" : "",
  ].filter(Boolean);

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
    shippingLabel:
      shippingFee === 0
        ? "送料無料候補"
        : typeof shippingFee === "number"
          ? `送料 ${shippingFee.toLocaleString("ja-JP")}円込みで再計算`
          : "送料条件は要確認",
    evidence,
  };
}

function buildOfficialPriceSignals(record: OfficialApiRecord, listPrice: number, source: MarketplaceSearchSource) {
  const shippingFee = extractOfficialShippingFee(record, source);
  const shippingName = readStringPath(record, ["shipping.name", "shippingLabel", "postageLabel"]);
  const shippingConditionRequired = Boolean(shippingName && hasConditionalShippingCopy(shippingName));
  const officialText = collectRecordText(record);
  const purchaseConditionRequired = hasPurchaseConditionCopy(officialText);
  const pointHasConditionalText =
    hasAmbiguousRewardCopy(officialText, ["point", "points", "ポイント"]) ||
    hasRewardMultiplierCopy(officialText, ["point", "points", "ポイント"]) ||
    hasRewardThresholdCopy(officialText, ["point", "points", "ポイント"]);
  const couponHasConditionalText =
    hasAmbiguousRewardCopy(officialText, ["coupon", "discount", "off", "クーポン"]) ||
    hasRewardThresholdCopy(officialText, ["coupon", "discount", "off", "クーポン"]);
  const rawPointValue =
    readRewardNumberPath(record, ["point.amount", "pointValue", "pointAmount", "points", "rewardPoint"], ["point", "points", "ポイント"]) ??
    inferPointValueFromRate(
      listPrice,
      readRewardNumberPath(record, ["pointRate", "point.rate", "pointRateValue"], ["point", "points", "ポイント"]),
    );
  const pointValue = pointHasConditionalText ? undefined : rawPointValue;
  const rawCouponValue =
    readRewardNumberPath(
      record,
      ["coupon.amount", "coupon.value", "couponAmount", "couponValue", "coupon.price", "discountAmount", "discount.amount"],
      ["coupon", "discount", "off", "クーポン"],
    ) ??
    inferPointValueFromRate(
      listPrice,
      readRewardNumberPath(record, ["coupon.rate", "couponRate", "discountRate"], ["coupon", "discount", "off", "クーポン"]),
    );
  const couponValue = couponHasConditionalText ? undefined : rawCouponValue;
  const pointStart = readStringPath(record, [
    "point.startTime",
    "point.start",
    "pointRateStartTime",
    "pointStartTime",
    "campaignStartTime",
  ]);
  const pointEnd = readStringPath(record, ["point.endTime", "point.end", "pointRateEndTime", "pointEndTime", "campaignEndTime"]);
  const couponStart = readStringPath(record, ["coupon.startTime", "coupon.start", "couponStartTime", "discountStartTime"]);
  const couponEnd = readStringPath(record, ["coupon.endTime", "coupon.end", "couponEndTime", "discountEndTime"]);
  const pointWindowRequired = Boolean(pointValue && (pointStart || pointEnd));
  const couponWindowRequired = Boolean(couponValue && (couponStart || couponEnd));
  const pointConditionRequired =
    !pointValue &&
    (hasAmbiguousRewardCopy(officialText, ["point", "points", "ポイント"]) ||
      hasRewardMultiplierCopy(officialText, ["point", "points", "ポイント"]) ||
      hasRewardThresholdCopy(officialText, ["point", "points", "ポイント"]));
  const couponConditionRequired =
    !couponValue &&
    (hasAmbiguousRewardCopy(officialText, ["coupon", "discount", "off", "クーポン"]) ||
      hasRewardThresholdCopy(officialText, ["coupon", "discount", "off", "クーポン"]));
  const evidence = [
    typeof shippingFee === "number" ? (shippingFee === 0 ? "official shipping: free" : `official shipping fee: ${shippingFee} JPY`) : "",
    shippingConditionRequired ? "official shipping condition requires retailer confirmation" : "",
    purchaseConditionRequired ? "official purchase condition requires retailer confirmation" : "",
    pointValue ? `official point value: ${pointValue} JPY` : "",
    pointConditionRequired ? "official point condition requires retailer confirmation" : "",
    couponValue ? `official coupon value: ${couponValue} JPY` : "",
    couponConditionRequired ? "official coupon condition requires retailer confirmation" : "",
    pointStart || pointEnd ? `point window: ${pointStart ?? "unknown"} - ${pointEnd ?? "unknown"}` : "",
    couponStart || couponEnd ? `coupon window: ${couponStart ?? "unknown"} - ${couponEnd ?? "unknown"}` : "",
  ].filter(Boolean);

  return {
    shippingFee,
    pointValue,
    couponValue,
    conditionLabels: [
      shippingConditionRequired ? "送料条件あり" : "",
      purchaseConditionRequired ? "購入条件あり" : "",
      pointWindowRequired ? "ポイント期間あり" : "",
      pointConditionRequired ? "ポイント条件あり" : "",
      couponWindowRequired ? "クーポン期間あり" : "",
      couponConditionRequired ? "クーポン条件あり" : "",
    ].filter(Boolean),
    shippingLabel:
      shippingFee === 0
        ? "送料無料"
        : typeof shippingFee === "number"
          ? `送料 ${shippingFee.toLocaleString("ja-JP")}円込みで再計算`
          : "送料条件は要確認",
    evidence,
  };
}

function appendConditionLabels<T extends { conditionLabels: string[]; conditionRequired: boolean }>(quote: T, labels: string[] = []): T {
  const conditionLabels = [...new Set([...quote.conditionLabels, ...labels])];
  return { ...quote, conditionLabels, conditionRequired: conditionLabels.length > 0 };
}

function extractOfficialShippingFee(record: OfficialApiRecord, source: MarketplaceSearchSource) {
  const explicit = readNumberPath(record, ["shippingFee", "postage", "postageAmount", "deliveryFee", "shipping.amount", "shipping.fee"]);
  if (typeof explicit === "number") return explicit;
  if (source === "rakuten" && readNumberPath(record, ["postageFlag"]) === 0) return 0;
  if (source === "yahoo-shopping" && readNumberPath(record, ["shipping.code"]) === 1) return 0;
  const shippingName = readStringPath(record, ["shipping.name", "shippingLabel", "postageLabel"]);
  if (shippingName && hasConditionalShippingCopy(shippingName)) return undefined;
  return shippingName && /送料無料|free shipping/i.test(shippingName) ? 0 : undefined;
}

function readNumberPath(record: OfficialApiRecord, paths: string[]) {
  for (const path of paths) {
    const value = readPath(record, path);
    const numeric = typeof value === "number" ? value : typeof value === "string" ? parseSearchAmount(value) : undefined;
    if (typeof numeric === "number") return numeric;
  }
  return undefined;
}

function readRewardNumberPath(record: OfficialApiRecord, paths: string[], labels: string[]) {
  for (const path of paths) {
    const value = readPath(record, path);
    if (typeof value === "number") return value;
    if (typeof value !== "string" || hasAmbiguousRewardCopy(`${path} ${value}`, labels)) continue;
    const numeric = parseSearchAmount(value);
    if (typeof numeric === "number") return numeric;
  }
  return undefined;
}

function readStringPath(record: OfficialApiRecord, paths: string[]) {
  for (const path of paths) {
    const value = readPath(record, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readPath(record: OfficialApiRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, record);
}

function collectRecordText(value: unknown): string {
  if (Array.isArray(value)) return value.map(collectRecordText).join(" ");
  if (!value || typeof value !== "object") return typeof value === "string" ? value : "";
  return Object.entries(value as Record<string, unknown>)
    .map(([key, nested]) => `${key} ${collectRecordText(nested)}`)
    .join(" ");
}

function extractPointValue(text: string, listPrice: number) {
  if (hasAmbiguousRewardCopy(text, ["point", "points", "ポイント"])) return undefined;
  if (hasRewardMultiplierCopy(text, ["point", "points", "ポイント"])) return undefined;
  if (hasRewardThresholdCopy(text, ["point", "points", "ポイント"])) return undefined;
  const explicit = extractAmountAroundLabel(text, ["ポイント", "point", "points"]);
  if (explicit && explicit / listPrice <= 0.35) return explicit;
  const rate = extractRateAroundLabel(text, ["ポイント", "point", "points"]);
  return rate && rate <= 30 ? inferPointValueFromRate(listPrice, rate) : undefined;
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
  if (hasUnconfirmedShippingCopy(text)) return true;

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
    "bundle",
    "multi-pack",
    "multipack",
    "pack of",
    "set of",
    "case",
  ];
  return purchaseWords.some((word) => new RegExp(escapeRegExp(word), "i").test(text));
}

function hasAmbiguousRewardCopy(text: string, labels: string[]) {
  const ambiguousWords = [
    "最大",
    "上限",
    "抽選",
    "予定",
    "対象者限定",
    "要エントリー",
    "エントリー",
    "ログイン",
    "要ログイン",
    "会員限定",
    "アプリ限定",
    "獲得予定",
    "付与予定",
    "up to",
    "max",
    "maximum",
    "campaign",
    "login",
    "app only",
    "member",
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
      const amount = parseSearchAmount(text.match(pattern)?.[1]);
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
      const rate = parseSearchAmount(text.match(pattern)?.[1]);
      if (rate && rate <= 80) return rate;
    }
  }
  return undefined;
}

function inferPointValueFromRate(price?: number, rate?: number) {
  if (!price || !rate || rate <= 0) return undefined;
  return Math.round(price * (rate / 100));
}

function parseSearchAmount(value?: string) {
  if (!value) return undefined;
  const amount = Number(toHalfWidth(value).replace(/[,，]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
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

function isDiscountAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 28);
  const nearestBeforeToken = before.trimEnd().match(/(?:^|\s)(\S{0,24})$/)?.[1] ?? "";
  const labelPrefix = `${nearestBeforeToken}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  const words = /(?:クーポン|値引き|値引|割引|割引額|off|discount|coupon|cashback)/i;
  return words.test(labelPrefix) || /^\s*(?:OFF|off|引き|値引き|値引|割引|割引額|discount|cashback)(?:\b|$)/i.test(after);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function calculateMatchScore(query: string, title: string) {
  const terms = normalizeQuery(query)
    .toLowerCase()
    .split(" ")
    .filter((term) => term.length >= 2);
  if (terms.length === 0) return 40;

  const normalizedTitle = title.toLowerCase();
  const matched = terms.filter((term) => normalizedTitle.includes(term)).length;
  const exactBonus = normalizedTitle.includes(normalizeQuery(query).toLowerCase()) ? 20 : 0;
  return Math.min(100, Math.round((matched / terms.length) * 80 + exactBonus));
}

function cleanText(value?: string) {
  if (!value) return undefined;
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function dedupeByUrl<T extends { url: string }>(candidate: T, index: number, candidates: T[]) {
  return candidates.findIndex((other) => other.url === candidate.url) === index;
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
