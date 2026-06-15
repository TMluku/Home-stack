import type { AppState, Autopilot, InventoryItem, Offer, QueueEntry } from "./types";

const URGENT_DAYS_THRESHOLD = 14;

export function calculateDaysLeft(item: InventoryItem, household: AppState["household"]) {
  const householdMultiplier = 1 + Math.max(0, household.adults - 2) * 0.12 + household.children * 0.08;
  const petMultiplier = item.category === "ペット用品" ? 1 + household.pets * 0.18 : 1;
  const adjustedUsage = Math.max(1, item.dailyUsage * householdMultiplier * petMultiplier);
  return Math.max(1, Math.round(item.stock / adjustedUsage));
}

export function getUrgency(daysLeft: number) {
  if (daysLeft <= 5) return "danger";
  if (daysLeft <= 10) return "warning";
  return "safe";
}

export function getUrgentInventory(state: AppState) {
  return [...state.inventory]
    .map((item) => ({ ...item, daysLeft: calculateDaysLeft(item, state.household) }))
    .filter((item) => item.daysLeft <= URGENT_DAYS_THRESHOLD)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function offerMatchesHousehold(offer: Offer, state: AppState) {
  if (offer.category === "ベビー用品") {
    return state.household.children > 0 || state.inventory.some((item) => item.category === "ベビー用品");
  }
  if (offer.category === "ペット用品") {
    return state.household.pets > 0 || state.inventory.some((item) => item.category === "ペット用品");
  }
  return true;
}

export function getRecommendedOffers(state: AppState, offers: Offer[]) {
  const urgentCategories = new Set(getUrgentInventory(state).map((item) => item.category));
  const visibleOffers = offers.filter((offer) => {
    const categoryMatches = urgentCategories.size === 0 || urgentCategories.has(offer.category);
    const conditionalAllowed = state.household.includeConditionalOffers || offer.conditions.length === 0;
    const filterMatches =
      state.activeFilter === "all" ||
      (state.activeFilter === "conditions" && offer.conditions.length > 0) ||
      (state.activeFilter === "no-conditions" && offer.conditions.length === 0);
    return categoryMatches && conditionalAllowed && filterMatches && offerMatchesHousehold(offer, state);
  });

  const fallbackOffers = offers.filter((offer) => offer.conditions.length === 0 && offerMatchesHousehold(offer, state));
  return sortOffersByEffectivePrice(visibleOffers.length > 0 ? visibleOffers : fallbackOffers);
}

export function sortOffersByEffectivePrice(offers: Offer[]) {
  return [...offers].sort((a, b) => a.effectivePrice - b.effectivePrice || a.listPrice - b.listPrice);
}

export function getBestOfferForCategory(category: string, state: AppState, offers: Offer[]) {
  return sortOffersByEffectivePrice(
    offers
      .filter((offer) => offer.category === category && offerMatchesHousehold(offer, state))
      .filter((offer) => state.household.includeConditionalOffers || offer.conditions.length === 0),
  )[0];
}

export function canAutoReserve(item: InventoryItem, offer: Offer, autopilot: Autopilot) {
  const isWithinAmount = offer.effectivePrice <= autopilot.maxAmount;
  const isAllowedItem = item.autoReplenish === true;
  const conditionalNeedsApproval = autopilot.requireApprovalForConditional && offer.conditions.length > 0;
  const brandChangeBlocked = autopilot.brandPolicy === "never" && offer.conditions.length > 0;
  return autopilot.enabled && isAllowedItem && isWithinAmount && !conditionalNeedsApproval && !brandChangeBlocked;
}

export function buildReplenishmentQueue(state: AppState, offers: Offer[]): QueueEntry[] {
  return getUrgentInventory(state)
    .map((item) => {
      const offer = getBestOfferForCategory(item.category, state, offers);
      if (!offer) return null;
      const decision = state.queueDecisions[item.id] || "pending";
      return {
        item,
        offer,
        decision,
        autoReservable: decision === "pending" && canAutoReserve(item, offer, state.autopilot),
        estimatedRevenue: Math.round(offer.effectivePrice * offer.affiliateRate),
      };
    })
    .filter((entry): entry is QueueEntry => Boolean(entry));
}

export function buildShoppingListSummary(entries: QueueEntry[]) {
  const actionableEntries = entries.filter(
    (entry) => entry.decision === "pending" || entry.decision === "approve" || entry.decision === "auto-reserve",
  );
  const totalEffectivePrice = actionableEntries.reduce((total, entry) => total + entry.offer.effectivePrice, 0);
  const estimatedRevenue = actionableEntries.reduce((total, entry) => total + entry.estimatedRevenue, 0);
  const conditionalCount = actionableEntries.filter((entry) => entry.offer.conditions.length > 0).length;
  const lines = actionableEntries.map((entry) => {
    const conditionLabel = entry.offer.conditions.length > 0 ? "条件あり" : "条件なし";
    return `${entry.item.name}: ${entry.offer.retailer} / 実質${entry.offer.effectivePrice}円 / ${conditionLabel}`;
  });

  return {
    itemCount: actionableEntries.length,
    totalEffectivePrice,
    conditionalCount,
    estimatedRevenue,
    lines,
  };
}

export function formatShoppingMemo(summary: ReturnType<typeof buildShoppingListSummary>) {
  if (summary.itemCount === 0) {
    return "Home Stack 買い物メモ\n補充候補はありません。";
  }

  return [
    "Home Stack 買い物メモ",
    ...summary.lines,
    `合計目安: ${summary.totalEffectivePrice.toLocaleString("ja-JP")}円`,
    `条件あり: ${summary.conditionalCount}件`,
  ].join("\n");
}
