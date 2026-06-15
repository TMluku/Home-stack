import type { ProductSearchCandidate, ProductSearchResult, ProductSearchSource } from "./types";

const MAX_HTML_BYTES = 1_500_000;
const USER_AGENT = "HomeStackPriceRadar/0.1 (+https://github.com/TMluku/Home-stack)";

type SearchSourceReport = ProductSearchResult["sources"][number];
type RawCandidate = Omit<ProductSearchCandidate, "id" | "matchScore" | "confidence" | "fetchedAt">;

const SOURCE_LABELS: Record<ProductSearchSource, string> = {
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
  const sources = [rakuten.report, yahoo.report];
  const candidates = rankCandidates([...rakuten.candidates, ...yahoo.candidates], normalizedQuery, searchedAt);

  return {
    query,
    normalizedQuery,
    searchedAt,
    candidates: candidates.slice(0, 12),
    sources,
  };
}

export function extractSearchCandidatesFromHtml(
  html: string,
  source: Exclude<ProductSearchSource, "direct-url">,
  baseUrl: string,
): RawCandidate[] {
  const decoded = decodeEntities(html);
  const snippets = splitIntoProductSnippets(decoded);

  const candidates: Array<RawCandidate | null> = snippets.map((snippet) => {
    const url = extractProductUrl(snippet, baseUrl);
    const price = extractPrice(snippet);
    const title = extractTitle(snippet);
    if (!url || !title || !price) return null;

    return {
      source,
      sourceLabel: SOURCE_LABELS[source],
      title,
      url,
      price,
      currency: "JPY",
      shipping: /送料無料|送料\s*0|free shipping/i.test(snippet) ? "送料無料候補" : "送料条件は要確認",
      imageUrl: extractImageUrl(snippet, baseUrl),
      evidence: [SOURCE_LABELS[source], "検索結果HTMLから商品名・価格・リンクを抽出"],
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
        };
      }>;
    };
    const candidates: RawCandidate[] =
      payload.Items?.map((entry) => entry.Item)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map(
          (item): RawCandidate => ({
            source: "rakuten",
            sourceLabel: SOURCE_LABELS.rakuten,
            title: item.itemName ?? "",
            url: item.itemUrl ?? "",
            price: item.itemPrice,
            currency: "JPY",
            shipping: item.postageFlag === 0 ? "送料無料" : "送料条件は要確認",
            imageUrl: item.mediumImageUrls?.[0]?.imageUrl?.replace(/\?_ex=\d+x\d+$/, ""),
            evidence: ["楽天市場公式API", "商品名・価格・商品URLをAPIレスポンスから取得"],
          }),
        )
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
      }>;
    };
    const candidates: RawCandidate[] =
      payload.hits
        ?.map(
          (item): RawCandidate => ({
            source: "yahoo-shopping",
            sourceLabel: SOURCE_LABELS["yahoo-shopping"],
            title: item.name ?? "",
            url: item.url ?? "",
            price: item.price,
            currency: "JPY",
            shipping: item.shipping?.name ?? (item.shipping?.code === 1 ? "送料無料" : "送料条件は要確認"),
            imageUrl: item.image?.medium,
            evidence: ["Yahoo!ショッピング公式API", "商品名・価格・商品URLをAPIレスポンスから取得"],
          }),
        )
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
  source: Exclude<ProductSearchSource, "direct-url">,
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
    .sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) || b.matchScore - a.matchScore);
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
  const priceText = text.match(/(?:¥|￥)\s*([0-9０-９][0-9０-９,，]*)|([0-9０-９][0-9０-９,，]*)\s*(?:円|JPY)/i);
  const raw = priceText?.[1] ?? priceText?.[2];
  if (!raw) return undefined;
  const price = Number(toHalfWidth(raw).replace(/[,，]/g, ""));
  return Number.isFinite(price) ? price : undefined;
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
