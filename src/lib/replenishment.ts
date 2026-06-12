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
    const sponsoredAllowed = state.household.allowSponsored || offer.labelType !== "sponsored";
    const filterMatches = state.activeFilter === "all" || offer.labelType === state.activeFilter;
    return categoryMatches && sponsoredAllowed && filterMatches && offerMatchesHousehold(offer, state);
  });

  return visibleOffers.length > 0 ? visibleOffers : offers.filter((offer) => offer.labelType === "lowest");
}

export function getBestOfferForCategory(category: string, state: AppState, offers: Offer[]) {
  return offers
    .filter((offer) => offer.category === category && offerMatchesHousehold(offer, state))
    .filter((offer) => state.household.allowSponsored || offer.labelType !== "sponsored")
    .sort((a, b) => a.price - b.price)[0];
}

export function canAutoReserve(item: InventoryItem, offer: Offer, autopilot: Autopilot) {
  const isWithinAmount = offer.price <= autopilot.maxAmount;
  const isAllowedItem = item.autoReplenish === true;
  const sponsoredNeedsApproval = autopilot.requireApprovalForSponsored && offer.labelType === "sponsored";
  const brandChangeBlocked = autopilot.brandPolicy === "never" && offer.labelType === "sponsored";
  return autopilot.enabled && isAllowedItem && isWithinAmount && !sponsoredNeedsApproval && !brandChangeBlocked;
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
        estimatedRevenue: Math.round(offer.price * offer.affiliateRate),
      };
    })
    .filter((entry): entry is QueueEntry => Boolean(entry));
}
