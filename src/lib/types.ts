export type Channel = "line" | "email" | "webpush";
export type OfferFilter = "all" | "no-conditions" | "conditions";
export type QueueDecision = "pending" | "approve" | "auto-reserve" | "snooze" | "cancel";
export type BrandPolicy = "never" | "cheaper-confirm" | "allow-same-spec";
export type DeliveryPolicy = "standard" | "fast";

export type Household = {
  adults: number;
  children: number;
  pets: number;
  channel: Channel;
  includeConditionalOffers: boolean;
  deletePhoto: boolean;
};

export type Autopilot = {
  enabled: boolean;
  maxAmount: number;
  cancelWindowHours: number;
  brandPolicy: BrandPolicy;
  deliveryPolicy: DeliveryPolicy;
  requireApprovalForConditional: boolean;
};

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  stock: number;
  dailyUsage: number;
  autoReplenish: boolean;
  note: string;
};

export type Metrics = {
  clicks: number;
  conditionalClicks: number;
  approvals: number;
  autoReservations: number;
  estimatedRevenue: number;
};

export type AppState = {
  household: Household;
  autopilot: Autopilot;
  inventory: InventoryItem[];
  metrics: Metrics;
  activeFilter: OfferFilter;
  queueDecisions: Record<string, QueueDecision>;
};

export type OfferCondition = {
  label: string;
  detail: string;
};

export type Offer = {
  id: string;
  priceMode: "demo" | "live";
  title: string;
  listPrice: number;
  effectivePrice: number;
  unitPrice: string;
  category: string;
  retailer: string;
  url: string;
  shipping: string;
  points: string;
  affiliateRate: number;
  detail: string;
  reason: string;
  linkText: string;
  comparedAt: string;
  conditions: OfferCondition[];
  comparisonBasis: string[];
  competitors: Array<{
    retailer: string;
    url: string;
    listPrice: number;
    effectivePrice: number;
    shipping: string;
    points: string;
    conditions: OfferCondition[];
    note: string;
  }>;
};

export type QueueEntry = {
  item: InventoryItem & { daysLeft: number };
  offer: Offer;
  decision: QueueDecision;
  autoReservable: boolean;
  estimatedRevenue: number;
};

export type LivePriceResult = {
  url: string;
  ok: boolean;
  title?: string;
  price?: number;
  currency?: string;
  source: "json-ld" | "meta" | "html-text" | "none";
  fetchedAt: string;
  error?: string;
};

export type ProductSearchSource = "rakuten" | "yahoo-shopping" | "direct-url";

export type ProductSearchCandidate = {
  id: string;
  source: ProductSearchSource;
  sourceLabel: string;
  title: string;
  url: string;
  price?: number;
  currency?: string;
  shipping?: string;
  imageUrl?: string;
  unitPrice?: string;
  matchScore: number;
  confidence: "high" | "medium" | "low";
  fetchedAt: string;
  evidence: string[];
  error?: string;
};

export type ProductSearchResult = {
  query: string;
  normalizedQuery: string;
  searchedAt: string;
  candidates: ProductSearchCandidate[];
  sources: Array<{
    source: ProductSearchSource;
    label: string;
    ok: boolean;
    searchedUrl?: string;
    error?: string;
    count: number;
  }>;
};
