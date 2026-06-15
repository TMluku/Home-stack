import type { LivePriceResult, Offer, ProductSearchCandidate, ProductSearchResult } from "./types";

const JAN_CATALOG: Record<string, { name: string; category: string; unitHint: string }> = {
  "4900000000016": { name: "猫砂 5L", category: "ペット用品", unitHint: "5L" },
  "4900000000023": { name: "洗濯洗剤 詰め替え", category: "洗濯・掃除", unitHint: "720g" },
  "4900000000030": { name: "トイレットペーパー 12ロール", category: "紙用品", unitHint: "12ロール" },
};

export function normalizeJanCode(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function isValidJanCode(value: string) {
  const code = normalizeJanCode(value);
  if (code.length !== 13) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function resolveJanProduct(value: string) {
  const code = normalizeJanCode(value);
  return JAN_CATALOG[code] ? { janCode: code, ...JAN_CATALOG[code] } : undefined;
}

export function buildMarketplaceSearchUrls(query: string) {
  const encoded = encodeURIComponent(query.trim());
  if (!encoded) return [];
  return [
    { label: "楽天市場", url: `https://search.rakuten.co.jp/search/mall/${encoded}/` },
    { label: "Yahoo!ショッピング", url: `https://shopping.yahoo.co.jp/search?p=${encoded}` },
    { label: "Amazon", url: `https://www.amazon.co.jp/s?k=${encoded}` },
  ];
}

export function buildStaticProductSearchResult(query: string, offers: Offer[], searchedAt = new Date().toISOString()): ProductSearchResult {
  const janProduct = resolveJanProduct(query);
  const normalizedQuery = janProduct ? `${janProduct.name} ${janProduct.unitHint}` : query.replace(/\s+/g, " ").trim();
  const matchingOffers = offers
    .filter((offer) => {
      const haystack = `${offer.title} ${offer.category} ${offer.retailer}`.toLowerCase();
      return normalizedQuery
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .some((term) => haystack.includes(term));
    })
    .slice(0, 6);

  const offerCandidates: ProductSearchCandidate[] = matchingOffers.map((offer, index) => ({
    id: `demo-${offer.id}`,
    source: "demo-catalog",
    sourceLabel: "デモ価格台帳",
    title: offer.title,
    url: offer.url,
    price: offer.effectivePrice,
    currency: "JPY",
    shipping: offer.shipping,
    unitPrice: offer.unitPrice,
    matchScore: Math.max(60, 96 - index * 8),
    confidence: index <= 1 ? "high" : "medium",
    fetchedAt: searchedAt,
    evidence: janProduct
      ? [`JAN ${janProduct.janCode}`, "デモ価格台帳から同カテゴリ候補を抽出"]
      : ["デモ価格台帳", "GitHub Pagesではサーバー検索の代わりにローカル候補を表示"],
  }));

  const linkCandidates: ProductSearchCandidate[] = buildMarketplaceSearchUrls(normalizedQuery).map((source, index) => ({
    id: `market-link-${index}`,
    source: "marketplace-link",
    sourceLabel: source.label,
    title: `${source.label}で ${normalizedQuery} を検索`,
    url: source.url,
    currency: "JPY",
    matchScore: 50,
    confidence: "low",
    fetchedAt: searchedAt,
    evidence: ["外部検索リンク", "価格取得API接続後に自動候補へ置き換え予定"],
  }));

  return {
    query,
    normalizedQuery,
    searchedAt,
    candidates: [...offerCandidates, ...linkCandidates],
    sources: [
      { source: "demo-catalog", label: "デモ価格台帳", ok: offerCandidates.length > 0, count: offerCandidates.length },
      { source: "marketplace-link", label: "外部検索リンク", ok: linkCandidates.length > 0, count: linkCandidates.length },
    ],
  };
}

export function buildStaticPriceScanResults(urls: string, scannedAt = new Date().toISOString()): LivePriceResult[] {
  return urls
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((url) => ({
      url,
      ok: false,
      source: "none",
      fetchedAt: scannedAt,
      error: "GitHub Pages版ではサーバー側価格取得は未接続です。API接続後にJSON-LD/meta/HTML抽出を実行します。",
    }));
}
