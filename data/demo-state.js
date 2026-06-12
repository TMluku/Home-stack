export const STORAGE_KEY = "home-stack-state-v4";

const defaultState = {
  household: {
    adults: 2,
    children: 1,
    pets: 1,
    channel: "line",
    allowSponsored: true,
    deletePhoto: true,
  },
  autopilot: {
    enabled: false,
    maxAmount: 5000,
    cancelWindowHours: 24,
    brandPolicy: "never",
    deliveryPolicy: "standard",
    requireApprovalForSponsored: true,
  },
  inventory: [
    {
      id: "cat-litter",
      name: "猫砂 5L",
      category: "ペット用品",
      stock: 22,
      dailyUsage: 4,
      autoReplenish: false,
      note: "前回購入から24日。1匹想定で残量少なめ。",
    },
    {
      id: "laundry-detergent",
      name: "洗濯洗剤 詰め替え",
      category: "洗濯・掃除",
      stock: 35,
      dailyUsage: 4,
      autoReplenish: false,
      note: "家族3人、週5回洗濯ペースで推定。",
    },
    {
      id: "toilet-paper",
      name: "トイレットペーパー 12ロール",
      category: "紙用品",
      stock: 48,
      dailyUsage: 3,
      autoReplenish: false,
      note: "残り6ロール想定。早めのまとめ買い候補。",
    },
  ],
  metrics: {
    clicks: 0,
    sponsoredClicks: 0,
    approvals: 0,
    autoReservations: 0,
    estimatedRevenue: 0,
  },
  activeFilter: "all",
  queueDecisions: {},
};

export const detectedInventoryCandidates = [
  ["おむつ Mサイズ", "ベビー用品", 28, 6, "写真候補: パッケージ下部の残量から少なめと推定。"],
  ["食器用洗剤", "洗濯・掃除", 42, 5, "写真候補: ボトルの透過領域から約4割と推定。"],
  ["ミネラルウォーター 2L", "食品・飲料", 30, 8, "写真候補: 箱の開封状態から残り少なめと推定。"],
];

export function createDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

export function normalizeState(savedState) {
  const fallback = createDefaultState();
  return {
    ...fallback,
    ...savedState,
    household: { ...fallback.household, ...savedState?.household },
    autopilot: { ...fallback.autopilot, ...savedState?.autopilot },
    inventory: Array.isArray(savedState?.inventory) ? savedState.inventory : fallback.inventory,
    metrics: { ...fallback.metrics, ...savedState?.metrics },
    queueDecisions: { ...fallback.queueDecisions, ...savedState?.queueDecisions },
  };
}
