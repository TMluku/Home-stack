import type { AppState, Channel, LivePriceResult, Offer, ProductSearchCandidate, ProductSearchResult, QueueEntry } from "./types";

export type ConditionAuditLogEntry = {
  id: string;
  offerId: string;
  offerTitle: string;
  retailer: string;
  url: string;
  listPrice: number;
  effectivePrice: number;
  shipping: string;
  points: string;
  conditionCount: number;
  conditionLabels: string[];
  conditionDetails: string[];
  evidence: string[];
  rankingBasis: string;
  generatedAt: string;
};

export type NotificationDraft = {
  id: string;
  channel: Channel;
  itemId: string;
  itemName: string;
  offerId: string;
  retailer: string;
  effectivePrice: number;
  daysLeft: number;
  conditionRequired: boolean;
  subject: string;
  message: string;
  actionUrl: string;
  generatedAt: string;
};

export type ServerSyncPayload = {
  schemaVersion: "post-mvp-sync-v1";
  generatedAt: string;
  account: {
    accountId: string;
    authMode: "demo" | "email-link" | "oauth";
  };
  state: AppState;
  auditLog: ConditionAuditLogEntry[];
  notificationDrafts: NotificationDraft[];
  summary: {
    inventoryCount: number;
    queueCount: number;
    conditionalAuditCount: number;
    notificationDraftCount: number;
  };
};

export type PriceFetchPlanStep = {
  id: string;
  source: "rakuten-api" | "yahoo-api" | "direct-page" | "marketplace-search";
  label: string;
  url: string;
  extractionPriority: Array<"official-api" | "json-ld" | "meta" | "html-text">;
  expectedFields: Array<"title" | "price" | "currency" | "shipping" | "points" | "conditions">;
};

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

export function buildPriceFetchPlan(query: string, directUrls: string[] = []): PriceFetchPlanStep[] {
  const marketplaceSteps: PriceFetchPlanStep[] = buildMarketplaceSearchUrls(query).map((source, index) => ({
    id: `marketplace-${index}`,
    source: source.label.includes("楽天") ? "rakuten-api" : source.label.includes("Yahoo") ? "yahoo-api" : "marketplace-search",
    label: source.label,
    url: source.url,
    extractionPriority: source.label.includes("Amazon")
      ? ["json-ld", "meta", "html-text"]
      : ["official-api", "json-ld", "meta", "html-text"],
    expectedFields: ["title", "price", "currency", "shipping", "points", "conditions"],
  }));

  const directSteps: PriceFetchPlanStep[] = directUrls
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((url, index) => ({
      id: `direct-${index}`,
      source: "direct-page",
      label: "商品ページ直接取得",
      url,
      extractionPriority: ["json-ld", "meta", "html-text"],
      expectedFields: ["title", "price", "currency", "shipping", "conditions"],
    }));

  return [...marketplaceSteps, ...directSteps];
}

export function buildConditionAuditLog(offers: Offer[], generatedAt = new Date().toISOString()): ConditionAuditLogEntry[] {
  return offers
    .flatMap((offer) =>
      offer.competitors.map((competitor, index) => ({
        id: `${offer.id}-${index}-${slugify(competitor.retailer)}`,
        offerId: offer.id,
        offerTitle: offer.title,
        retailer: competitor.retailer,
        url: competitor.url,
        listPrice: competitor.listPrice,
        effectivePrice: competitor.effectivePrice,
        shipping: competitor.shipping,
        points: competitor.points,
        conditionCount: competitor.conditions.length,
        conditionLabels: competitor.conditions.map((condition) => condition.label),
        conditionDetails: competitor.conditions.map((condition) => condition.detail),
        evidence: [competitor.note, ...offer.comparisonBasis],
        rankingBasis: "実質価格、送料、ポイント還元、条件有無を同一カテゴリ内で比較",
        generatedAt,
      })),
    )
    .sort((a, b) => a.effectivePrice - b.effectivePrice || a.listPrice - b.listPrice || a.retailer.localeCompare(b.retailer, "ja"));
}

export function buildNotificationDrafts(
  queue: QueueEntry[],
  channel: Channel,
  generatedAt = new Date().toISOString(),
): NotificationDraft[] {
  return queue
    .filter((entry) => entry.decision === "pending" || entry.decision === "approve" || entry.decision === "auto-reserve")
    .map((entry) => {
      const conditionRequired = entry.offer.conditions.length > 0;
      const subject = `${entry.item.name}の補充候補`;
      const conditionText = conditionRequired ? "条件付き価格です。購入前に条件を確認してください。" : "条件なし価格です。";

      return {
        id: `${entry.item.id}-${entry.offer.id}-${channel}`,
        channel,
        itemId: entry.item.id,
        itemName: entry.item.name,
        offerId: entry.offer.id,
        retailer: entry.offer.retailer,
        effectivePrice: entry.offer.effectivePrice,
        daysLeft: entry.item.daysLeft,
        conditionRequired,
        subject,
        message: `${entry.item.name}は残り約${entry.item.daysLeft}日です。${entry.offer.retailer}の実質価格は${entry.offer.effectivePrice.toLocaleString("ja-JP")}円。${conditionText}`,
        actionUrl: entry.offer.url,
        generatedAt,
      };
    });
}

export function buildServerSyncPayload({
  state,
  auditLog,
  notificationDrafts,
  accountId = "demo-account",
  authMode = "demo",
  generatedAt = new Date().toISOString(),
}: {
  state: AppState;
  auditLog: ConditionAuditLogEntry[];
  notificationDrafts: NotificationDraft[];
  accountId?: string;
  authMode?: ServerSyncPayload["account"]["authMode"];
  generatedAt?: string;
}): ServerSyncPayload {
  return {
    schemaVersion: "post-mvp-sync-v1",
    generatedAt,
    account: {
      accountId,
      authMode,
    },
    state,
    auditLog,
    notificationDrafts,
    summary: {
      inventoryCount: state.inventory.length,
      queueCount: Object.keys(state.queueDecisions).length,
      conditionalAuditCount: auditLog.filter((entry) => entry.conditionCount > 0).length,
      notificationDraftCount: notificationDrafts.length,
    },
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
