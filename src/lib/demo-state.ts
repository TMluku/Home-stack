import type { AppState, InventoryItem } from "./types";

export const STORAGE_KEY = "home-stack-state-v7";

export const categories = ["ペット用品", "ベビー用品", "洗濯・掃除", "紙用品", "食品・飲料"] as const;

const defaultState: AppState = {
  household: {
    adults: 2,
    children: 1,
    pets: 1,
    channel: "line",
    includeConditionalOffers: true,
    deletePhoto: true,
  },
  autopilot: {
    enabled: false,
    maxAmount: 5000,
    cancelWindowHours: 24,
    brandPolicy: "never",
    deliveryPolicy: "standard",
    requireApprovalForConditional: true,
  },
  inventory: [
    {
      id: "cat-litter",
      name: "猫砂 5L",
      category: "ペット用品",
      stock: 22,
      dailyUsage: 4,
      autoReplenish: false,
      note: "前回購入から24日。残量が少なくなり始めています。",
    },
    {
      id: "laundry-detergent",
      name: "洗濯洗剤 詰め替え",
      category: "洗濯・掃除",
      stock: 35,
      dailyUsage: 4,
      autoReplenish: false,
      note: "家族3人、週5回の洗濯ペースで推定しています。",
    },
    {
      id: "toilet-paper",
      name: "トイレットペーパー 12ロール",
      category: "紙用品",
      stock: 48,
      dailyUsage: 3,
      autoReplenish: false,
      note: "残り6ロール想定。まとめ買い候補です。",
    },
  ],
  metrics: {
    clicks: 0,
    conditionalClicks: 0,
    approvals: 0,
    autoReservations: 0,
    estimatedRevenue: 0,
  },
  activeFilter: "all",
  queueDecisions: {},
};

export const detectedInventoryCandidates: Array<Omit<InventoryItem, "id" | "autoReplenish">> = [
  {
    name: "おしりふき Mサイズ",
    category: "ベビー用品",
    stock: 28,
    dailyUsage: 6,
    note: "写真候補: パッケージ下部の残量から少なめと推定しました。",
  },
  {
    name: "食器用洗剤",
    category: "洗濯・掃除",
    stock: 42,
    dailyUsage: 5,
    note: "写真候補: ボトルの透明度から約4割と推定しました。",
  },
  {
    name: "ミネラルウォーター 2L",
    category: "食品・飲料",
    stock: 30,
    dailyUsage: 8,
    note: "写真候補: 箱の開封状態から残り少なめと推定しました。",
  },
];

export function createDefaultState(): AppState {
  return structuredClone(defaultState);
}

export function normalizeState(savedState: unknown): AppState {
  const fallback = createDefaultState();
  if (!savedState || typeof savedState !== "object") return fallback;
  const saved = savedState as Partial<AppState>;
  const savedHousehold = saved.household as Partial<AppState["household"]> | undefined;
  const savedAutopilot = saved.autopilot as Partial<AppState["autopilot"]> | undefined;
  const savedMetrics = saved.metrics as Partial<AppState["metrics"]> | undefined;

  const savedActiveFilter = saved.activeFilter as AppState["activeFilter"] | "lowest" | "sponsored" | undefined;

  return {
    ...fallback,
    ...saved,
    household: {
      ...fallback.household,
      ...savedHousehold,
      includeConditionalOffers:
        savedHousehold?.includeConditionalOffers ?? (savedHousehold as { allowSponsored?: boolean } | undefined)?.allowSponsored ?? true,
    },
    autopilot: {
      ...fallback.autopilot,
      ...savedAutopilot,
      requireApprovalForConditional:
        savedAutopilot?.requireApprovalForConditional ??
        (savedAutopilot as { requireApprovalForSponsored?: boolean } | undefined)?.requireApprovalForSponsored ??
        true,
    },
    inventory: Array.isArray(saved.inventory) ? saved.inventory : fallback.inventory,
    metrics: {
      ...fallback.metrics,
      ...savedMetrics,
      conditionalClicks:
        savedMetrics?.conditionalClicks ?? (savedMetrics as { sponsoredClicks?: number } | undefined)?.sponsoredClicks ?? 0,
    },
    activeFilter:
      savedActiveFilter === "lowest" || savedActiveFilter === "sponsored" ? "all" : (savedActiveFilter ?? fallback.activeFilter),
    queueDecisions: { ...fallback.queueDecisions, ...saved.queueDecisions },
  };
}
