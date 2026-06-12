export type Channel = "line" | "email" | "webpush";
export type OfferLabelType = "lowest" | "sponsored";
export type OfferFilter = "all" | OfferLabelType;
export type QueueDecision = "pending" | "approve" | "auto-reserve" | "snooze" | "cancel";
export type BrandPolicy = "never" | "cheaper-confirm" | "allow-same-spec";
export type DeliveryPolicy = "standard" | "fast";

export type Household = {
  adults: number;
  children: number;
  pets: number;
  channel: Channel;
  allowSponsored: boolean;
  deletePhoto: boolean;
};

export type Autopilot = {
  enabled: boolean;
  maxAmount: number;
  cancelWindowHours: number;
  brandPolicy: BrandPolicy;
  deliveryPolicy: DeliveryPolicy;
  requireApprovalForSponsored: boolean;
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
  sponsoredClicks: number;
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

export type Offer = {
  id: string;
  label: string;
  labelType: OfferLabelType;
  priceMode: "demo" | "live";
  title: string;
  price: number;
  unitPrice: string;
  category: string;
  retailer: string;
  shipping: string;
  points: string;
  affiliateRate: number;
  detail: string;
  reason: string;
  linkText: string;
  comparedAt: string;
  comparisonBasis: string[];
  competitors: Array<{
    retailer: string;
    price: number;
    shipping: string;
    points: string;
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
