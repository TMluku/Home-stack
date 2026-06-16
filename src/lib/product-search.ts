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
    if (hasUsedConditionCopy(title)) return null;
    if (hasUnavailableOfferCopy(snippet)) return null;
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
        .filter((item) => !hasUnavailableMachineState(item as OfficialApiRecord))
        .filter((item) => !hasUsedConditionCopy(collectRecordText(item)))
        .filter((item) => !hasUnavailableOfferCopy(collectRecordText(item)))
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
        ?.filter((item) => !hasUnavailableMachineState(item as OfficialApiRecord))
        ?.filter((item) => !hasUsedConditionCopy(collectRecordText(item)))
        ?.filter((item) => !hasUnavailableOfferCopy(collectRecordText(item)))
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
          (b.effectivePriceQuote?.effectivePrice ?? b.price ?? Number.MAX_SAFE_INTEGER) ||
        (a.price ?? a.effectivePriceQuote?.listPrice ?? Number.MAX_SAFE_INTEGER) -
          (b.price ?? b.effectivePriceQuote?.listPrice ?? Number.MAX_SAFE_INTEGER) ||
        b.matchScore - a.matchScore,
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
    if (isAdditionalItemPriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isRestrictedAudiencePriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isSubscriptionPriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isRangeLowerBoundPriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isEffectivePriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isInstallmentAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isNonProductFeeAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isRewardAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isConditionThresholdAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isDiscountAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isCouponAppliedPriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isFreeShippingProgressAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isShippingConditionAmountContext(text, match.index ?? 0, match[0].length)) continue;
    if (isTaxExcludedContext(text, match.index ?? 0, match[0].length)) continue;
    if (isReferencePriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isExpiredSalePriceContext(text, match.index ?? 0, match[0].length)) continue;
    if (isUsedConditionPriceContext(text, match.index ?? 0, match[0].length)) continue;
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
  const pointRewardLooksConditional = hasDateLikeRewardCopy(text, ["point", "points"]);
  const couponRewardLooksConditional =
    hasDateLikeRewardCopy(text, ["coupon", "discount", "off"]) || hasCouponCodeConditionCopy(text) || hasConditionalDiscountPriceCopy(text);
  const pointValue = pointRewardLooksConditional ? undefined : extractPointValue(text, listPrice);
  const couponValue = couponRewardLooksConditional ? undefined : extractCouponValue(text, listPrice);
  const pointRewardAmountTooLarge = hasOversizedRewardAmount(text, ["point", "points"], listPrice, 0.35);
  const couponRewardAmountTooLarge = hasOversizedRewardAmount(text, ["coupon", "discount", "off"], listPrice, 0.6);
  let pointConditionRequired =
    !pointValue &&
    (hasAmbiguousRewardCopy(text, ["point", "points", "ポイント"]) ||
      hasRewardMultiplierCopy(text, ["point", "points", "ポイント"]) ||
      hasDateLikeRewardCopy(text, ["point", "points", "ポイント"]) ||
      hasRewardThresholdCopy(text, ["point", "points", "ポイント"]));
  let couponConditionRequired =
    !couponValue &&
    (hasAmbiguousRewardCopy(text, ["coupon", "discount", "off", "クーポン"]) ||
      hasRewardThresholdCopy(text, ["coupon", "discount", "off", "クーポン"]) ||
      hasDateLikeRewardCopy(text, ["coupon", "discount", "off", "クーポン"]) ||
      hasCouponCodeConditionCopy(text) ||
      hasConditionalDiscountPriceCopy(text));
  pointConditionRequired = pointConditionRequired || (!pointValue && pointRewardAmountTooLarge);
  couponConditionRequired = couponConditionRequired || (!couponValue && couponRewardAmountTooLarge);
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
  const officialText = collectRecordText(record);
  const shippingConditionRequired = hasConditionalShippingCopy(officialText);
  const shippingFee = shippingConditionRequired ? undefined : extractOfficialShippingFee(record, source);
  const purchaseConditionRequired = hasPurchaseConditionCopy(officialText);
  const pointHasConditionalText =
    hasAmbiguousRewardCopy(officialText, ["point", "points", "ポイント"]) ||
    hasRewardMultiplierCopy(officialText, ["point", "points", "ポイント"]) ||
    hasRewardThresholdCopy(officialText, ["point", "points", "ポイント"]) ||
    hasDateLikeRewardCopy(officialText, ["point", "points", "ポイント"]);
  const couponHasConditionalText =
    hasAmbiguousRewardCopy(officialText, ["coupon", "discount", "off", "クーポン"]) ||
    hasRewardThresholdCopy(officialText, ["coupon", "discount", "off", "クーポン"]) ||
    hasDateLikeRewardCopy(officialText, ["coupon", "discount", "off", "クーポン"]) ||
    hasCouponCodeConditionCopy(officialText) ||
    hasConditionalDiscountPriceCopy(officialText);
  const rawPointValue =
    readRewardNumberPath(record, ["point.amount", "pointValue", "pointAmount", "points", "rewardPoint"], ["point", "points", "ポイント"]) ??
    inferPointValueFromRate(
      listPrice,
      readRewardNumberPath(record, ["pointRate", "point.rate", "pointRateValue"], ["point", "points", "ポイント"]),
    );
  const pointStart = readStringPath(record, [
    "point.startTime",
    "point.start",
    "pointRateStartTime",
    "pointStartTime",
    "campaignStartTime",
  ]);
  const pointEnd = readStringPath(record, ["point.endTime", "point.end", "pointRateEndTime", "pointEndTime", "campaignEndTime"]);
  const pointWindowExpired = Boolean(rawPointValue && isPastDateTime(pointEnd));
  const pointWindowFuture = Boolean(rawPointValue && isFutureDateTime(pointStart));
  const pointRewardAmountTooLarge = Boolean(rawPointValue && listPrice && rawPointValue / listPrice > 0.35);
  const pointValue =
    pointHasConditionalText || pointWindowExpired || pointWindowFuture || pointRewardAmountTooLarge ? undefined : rawPointValue;
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
  const couponStart = readStringPath(record, ["coupon.startTime", "coupon.start", "couponStartTime", "discountStartTime"]);
  const couponEnd = readStringPath(record, ["coupon.endTime", "coupon.end", "couponEndTime", "discountEndTime"]);
  const couponWindowExpired = Boolean(rawCouponValue && isPastDateTime(couponEnd));
  const couponWindowFuture = Boolean(rawCouponValue && isFutureDateTime(couponStart));
  const couponRewardAmountTooLarge = Boolean(rawCouponValue && listPrice && rawCouponValue / listPrice > 0.6);
  const couponValue =
    couponHasConditionalText || couponWindowExpired || couponWindowFuture || couponRewardAmountTooLarge ? undefined : rawCouponValue;
  const pointWindowRequired = Boolean(pointValue && (pointStart || pointEnd)) || pointWindowExpired || pointWindowFuture;
  const couponWindowRequired = Boolean(couponValue && (couponStart || couponEnd)) || couponWindowExpired || couponWindowFuture;
  const pointConditionRequired =
    !pointValue && (pointHasConditionalText || pointWindowExpired || pointWindowFuture || pointRewardAmountTooLarge);
  const couponConditionRequired =
    !couponValue && (couponHasConditionalText || couponWindowExpired || couponWindowFuture || couponRewardAmountTooLarge);
  const evidence = [
    typeof shippingFee === "number" ? (shippingFee === 0 ? "official shipping: free" : `official shipping fee: ${shippingFee} JPY`) : "",
    shippingConditionRequired ? "official shipping condition requires retailer confirmation" : "",
    purchaseConditionRequired ? "official purchase condition requires retailer confirmation" : "",
    pointValue ? `official point value: ${pointValue} JPY` : "",
    pointConditionRequired ? "official point condition requires retailer confirmation" : "",
    couponValue ? `official coupon value: ${couponValue} JPY` : "",
    couponConditionRequired ? "official coupon condition requires retailer confirmation" : "",
    pointStart || pointEnd ? `point window: ${pointStart ?? "unknown"} - ${pointEnd ?? "unknown"}` : "",
    pointWindowExpired ? "official point window expired before fetch" : "",
    pointWindowFuture ? "official point window starts after fetch" : "",
    couponStart || couponEnd ? `coupon window: ${couponStart ?? "unknown"} - ${couponEnd ?? "unknown"}` : "",
    couponWindowExpired ? "official coupon window expired before fetch" : "",
    couponWindowFuture ? "official coupon window starts after fetch" : "",
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
    if (typeof value !== "string" || hasAmbiguousRewardCopy(`${path} ${value}`, labels) || isDateLikeRewardText(value)) continue;
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

function isPastDateTime(value?: string) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time < Date.now();
}

function isFutureDateTime(value?: string) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now();
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

function hasUnavailableMachineState(record: OfficialApiRecord) {
  const textState = readStringPath(record, [
    "availability",
    "availabilityStatus",
    "itemAvailability",
    "saleStatus",
    "stockStatus",
    "status",
  ]);
  if (textState && hasUnavailableOfferCopy(textState)) return true;

  const booleanPaths = ["available", "isAvailable", "inStock", "isInStock", "stock.available", "inventory.available"];
  for (const path of booleanPaths) {
    const value = readPath(record, path);
    if (value === false) return true;
  }

  const numericPaths = ["availability", "stock", "stockQuantity", "inventory", "inventoryCount", "inventory.quantity"];
  for (const path of numericPaths) {
    const value = readPath(record, path);
    if (value === 0 || value === "0") return true;
  }

  return false;
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

function hasOversizedRewardAmount(text: string, labels: string[], listPrice: number, maxRatio: number) {
  if (!listPrice) return false;
  const explicit = extractAmountAroundLabel(text, labels);
  return Boolean(explicit && explicit / listPrice > maxRatio);
}

function extractShippingFeeFromText(text: string) {
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
    "会員限定",
    "メンバー限定",
    "アプリ限定",
    "LINE限定",
    "ログイン限定",
    "プレミアム会員",
    "カード会員",
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
    "member-only",
    "members only",
    "app-only",
    "app only",
    "login required",
    "premium member",
    "card member",
  ];
  return purchaseWords.some((word) => new RegExp(escapeRegExp(word), "i").test(text));
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
    "campaign",
    "limited time",
    "bonus",
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

function hasDateLikeRewardCopy(text: string, labels: string[]) {
  return labels.some((label) => {
    const escapedLabel = escapeRegExp(label);
    return new RegExp(
      `${escapedLabel}.{0,80}(?:valid|expires?|through|until|期限|有効|終了|開始|期間).{0,24}[12][0-9]{3}[-/年][0-9]{1,2}[-/月][0-9]{1,2}`,
      "i",
    ).test(toHalfWidth(text));
  });
}

function isDateLikeRewardText(value: string) {
  return /(?:valid|expires?|through|until|期限|有効|終了|開始|期間).{0,24}[12][0-9]{3}[-/年][0-9]{1,2}[-/月][0-9]{1,2}|[12][0-9]{3}[-/年][0-9]{1,2}[-/月][0-9]{1,2}.{0,24}(?:valid|expires?|through|until|期限|有効|終了|開始|期間)/i.test(
    toHalfWidth(value),
  );
}

function hasCouponCodeConditionCopy(text: string) {
  return /(?:クーポン(?:コード)?|プロモ(?:コード)?|割引コード|coupon\s+code|promo\s+code|promotion\s+code|discount\s+code).{0,40}(?:適用|入力|利用|取得|対象|条件|required|apply|applied|enter|with)|(?:適用|入力|利用|取得|対象|条件|required|apply|applied|enter|with).{0,40}(?:クーポン(?:コード)?|プロモ(?:コード)?|割引コード|coupon\s+code|promo\s+code|promotion\s+code|discount\s+code)/i.test(
    text,
  );
}

function hasConditionalDiscountPriceCopy(text: string) {
  if (
    /(?:coupon|promo|promotion|discount).{0,80}(?:after|applied|clipped|clip|with|required)|(?:after|applied|clipped|clip|with|required).{0,80}(?:coupon|promo|promotion|discount)/i.test(
      text,
    )
  ) {
    return true;
  }
  return /(?:繧ｯ繝ｼ繝昴Φ|繝励Ο繝｢|蜑ｲ蠑怖coupon|promo|promotion|discount).{0,80}(?:驕ｩ逕ｨ蠕芸驕ｩ逕ｨ|蛻ｩ逕ｨ蠕芸蜿門ｾ怜ｾ芸蟇ｾ雎｡|譚｡莉ｶ|after|applied|clipped|clip|with|required)|(?:驕ｩ逕ｨ蠕芸驕ｩ逕ｨ|蛻ｩ逕ｨ蠕芸蜿門ｾ怜ｾ芸蟇ｾ雎｡|譚｡莉ｶ|after|applied|clipped|clip|with|required).{0,80}(?:繧ｯ繝ｼ繝昴Φ|繝励Ο繝｢|蜑ｲ蠑怖coupon|promo|promotion|discount)/i.test(
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

function isAdditionalItemPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 36), index);
  const after = text.slice(index + length, index + length + 40);
  const ordinalItem = /(?:[2２二]\s*(?:点|個|枚|本|袋|箱|品)\s*目|second\s+item|2nd\s+item|additional\s+item|extra\s+item)/i;
  const conditionalPriceWords = /(?:半額|無料|割引|値引|特価|価格|off|discount|deal|price)/i;
  const beforeTail = before.slice(-28);
  const ordinalMatch = beforeTail.match(ordinalItem);
  const afterOrdinal = ordinalMatch ? beforeTail.slice((ordinalMatch.index ?? 0) + ordinalMatch[0].length) : "";
  const hasInterveningPrice = /(?:¥|￥)\s*[0-9０-９]|[0-9０-９][0-9０-９,，]*\s*(?:円|JPY)/i.test(afterOrdinal);
  return (
    (Boolean(ordinalMatch) &&
      !hasInterveningPrice &&
      (conditionalPriceWords.test(beforeTail) || /^\s*(?:円|JPY)?\s*(?:なら|で|only|each)/i.test(after))) ||
    /^\s*(?:なら|で|for|as)\s*(?:the\s*)?(?:second\s+item|2nd\s+item|additional\s+item|extra\s+item|[2２二]\s*(?:点|個|枚|本|袋|箱|品)\s*目)/i.test(
      after,
    )
  );
}

function isRestrictedAudiencePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 34), index);
  const after = text.slice(index + length, index + length + 34);
  const beforeTail = before.slice(-30);
  const restrictedBefore =
    /(?:会員(?:限定)?|メンバー(?:限定)?|アプリ(?:限定)?|LINE(?:限定)?|ログイン(?:限定)?|プレミアム(?:会員)?|カード会員|prime|member|members only|member-only|app only|app-only|login required|premium member|card member)\s*(?:価格|特価|限定価格|割引価格|price|deal)?\s*$/i;
  const restrictedAfter =
    /^\s*(?:の)?\s*(?:会員(?:限定)?|メンバー(?:限定)?|アプリ(?:限定)?|LINE(?:限定)?|ログイン(?:限定)?|プレミアム(?:会員)?|カード会員|prime|member|members only|member-only|app only|app-only|login required|premium member|card member)\s*(?:価格|特価|限定価格|割引価格|price|deal)?/i;
  return restrictedBefore.test(beforeTail) || restrictedAfter.test(after);
}

function isSubscriptionPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 36), index);
  const after = text.slice(index + length, index + length + 40);
  const beforeTail = before.slice(-32);
  const subscriptionBefore =
    /(?:定期(?:購入)?|定期おトク便|おトク便|サブスク|subscribe\s*&\s*save|subscribe(?:\s+and\s+save)?|subscription)\s*(?:価格|特価|割引価格|price|deal)?\s*$/i;
  const subscriptionAfter =
    /^\s*(?:の)?\s*(?:定期(?:購入)?|定期おトク便|おトク便|サブスク|subscribe\s*&\s*save|subscribe(?:\s+and\s+save)?|subscription)\s*(?:価格|特価|割引価格|price|deal)?/i;
  return subscriptionBefore.test(beforeTail) || subscriptionAfter.test(after);
}

function isRangeLowerBoundPriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 28), index);
  const after = text.slice(index + length, index + length + 28);
  return (
    /(?:から|より|from|as low as|starting at|starts? from|バリエーション|variant)\s*$/i.test(before) ||
    /^\s*(?:〜|～|から|より|and up|\+|or more|以上|バリエーション|variant)/i.test(after)
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
  const labelBefore = /(?:月々|月額|毎月|分割|ローン|あと払い|リボ|installments?|installment|monthly|per month)\s*$/i;
  const labelAfter = /^\s*(?:\/\s*(?:月|mo|month)|ずつ|から|の分割|分割|月額|毎月|per month|monthly|installments?)/i;
  return labelBefore.test(before) || labelAfter.test(after);
}

function isNonProductFeeAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 30), index);
  const after = text.slice(index + length, index + length + 26);
  const feeWords =
    /(?:代引|決済|支払|支払い|事務|取扱|取扱い|手数料|保証金|預り金|預かり金|デポジット|deposit|security deposit|fee|fees|handling|processing|payment|cod|cash on delivery)\s*$/i;
  const feeAfter = /^\s*(?:の)?\s*(?:手数料|保証金|預り金|預かり金|デポジット|deposit|security deposit|fee|fees|handling|processing)/i;
  const paymentFeeAfter = /^\s*(?:payment|cod|cash on delivery)/i.test(after);
  return feeWords.test(before) || feeAfter.test(after) || paymentFeeAfter;
}

function isDiscountAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 28);
  const nearestBeforeToken = before.trimEnd().match(/(?:^|\s)(\S{0,24})$/)?.[1] ?? "";
  const matchedText = text.slice(index, index + length);
  const labelPrefix = `${nearestBeforeToken}${matchedText.replace(/[0-9０-９].*$/, "")}`;
  const words = /(?:クーポン|値引き|値引|割引|割引額|off|discount|coupon|cashback)/i;
  return (
    words.test(labelPrefix) ||
    /^\s*(?:OFF|off|引き|値引き|値引|割引|割引額|discount|cashback)(?:\b|$)/i.test(after) ||
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
  const words =
    /(?:ポイント|還元|付与|獲得|PayPay|楽天ポイント|ギフト券|商品券|ストアクレジット|次回使える|次回購入|point|points|reward|cashback|gift card|gift certificate|voucher|store credit|next order|next purchase)/i;
  const rewardLabelBefore =
    /(?:ポイント|還元|付与|獲得|PayPay|楽天ポイント|ギフト券|商品券|ストアクレジット|次回使える|次回購入|point|points|reward|cashback|gift card|gift certificate|voucher|store credit|next order|next purchase)\s*$/i;
  return words.test(labelPrefix) || rewardLabelBefore.test(before) || /^\s*(?:分|相当|pt|pts)(?:\b|$)/i.test(after);
}

function isConditionThresholdAmountContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 48);
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
  const referenceWords = /(?:通常価格|参考価格|メーカー希望小売価格|定価|list price|regular price|was price|original price)\s*[:：-]?\s*$/i;
  return (
    referenceWords.test(labelPrefix) ||
    referenceWords.test(before) ||
    /^\s*(?:通常価格|参考価格|メーカー希望小売価格|定価|list price|regular price|was price|original price)/i.test(after)
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

function hasUnavailableOfferCopy(text: string) {
  const cleaned = cleanText(text) ?? text;
  const unavailable =
    /(?:在庫なし|売り切れ|売切れ|完売|販売終了|品切れ|入荷待ち|入荷予定|予約販売|予約受付|発売前|販売前|sold\s*out|soldout|out\s*of\s*stock|outofstock|out[_-]of[_-]stock|unavailable|discontinued|pre-?order|coming soon|not yet available)/i.test(
      cleaned,
    );
  const available =
    /(?:販売中|販売価格|通常販売価格|在庫あり|購入可能|\bavailable\b|\bin\s*stock\b|item price|one-time purchase price)/i.test(cleaned);
  return unavailable && !available;
}

function isUnavailablePriceContext(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 44), index);
  const after = text.slice(index + length, index + length + 24);
  const labelPrefix = `${before.replace(/^.*[0-9０-９][^0-9０-９]*/, "")}${text.slice(index, index + length).replace(/[0-9０-９].*$/, "")}`;
  const words =
    /(?:在庫なし|売り切れ|売切れ|販売終了|入荷待ち|入荷予定|品切れ|予約価格|予約販売|予約受付|発売前|販売前|sold\s*out|soldout|out\s*of\s*stock|outofstock|out[_-]of[_-]stock|unavailable|discontinued|pre-?order|coming soon|not yet available)/i;
  const wordsBefore =
    /(?:在庫なし|売り切れ|売切れ|販売終了|入荷待ち|入荷予定|品切れ|予約価格|予約販売|予約受付|発売前|販売前|sold\s*out|soldout|out\s*of\s*stock|outofstock|out[_-]of[_-]stock|unavailable|discontinued|pre-?order|coming soon|not yet available)\s*$/i;
  return words.test(labelPrefix) || wordsBefore.test(before) || words.test(after);
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
