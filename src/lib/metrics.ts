import type { Metrics, QueueDecision } from "./types";

export function recordOutboundClick(metrics: Metrics, effectivePrice: number, affiliateRate: number, isConditional: boolean) {
  metrics.clicks += 1;
  if (isConditional) metrics.conditionalClicks += 1;
  metrics.estimatedRevenue += Math.round(effectivePrice * affiliateRate);
}

export function recordQueueDecision(metrics: Metrics, decision: QueueDecision, estimatedRevenue = 0) {
  if (decision !== "approve" && decision !== "auto-reserve") return;
  metrics.approvals += 1;
  metrics.clicks += 1;
  metrics.estimatedRevenue += estimatedRevenue;
  if (decision === "auto-reserve") metrics.autoReservations += 1;
}
