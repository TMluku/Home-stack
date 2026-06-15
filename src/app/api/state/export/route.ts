import { NextResponse } from "next/server";
import { createDefaultState, normalizeState } from "@/lib/demo-state";
import { baseOffers } from "@/lib/offers";
import { buildConditionAuditLog, buildNotificationDrafts, buildServerSyncPayload } from "@/lib/post-mvp";
import { buildReplenishmentQueue, getRecommendedOffers } from "@/lib/replenishment";
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    state?: unknown;
    accountId?: unknown;
    authMode?: unknown;
  } | null;

  const state = normalizeState(body?.state ?? createDefaultState());
  const accountId = typeof body?.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : "demo-account";
  const authMode = parseAuthMode(body?.authMode);
  const generatedAt = new Date().toISOString();
  const offers = getRecommendedOffers(state, baseOffers);
  const queue = buildReplenishmentQueue(state, baseOffers);
  const auditLog = buildConditionAuditLog(offers, generatedAt);
  const notificationDrafts = buildNotificationDrafts(queue, state.household.channel, generatedAt);
  const payload = buildServerSyncPayload({
    state,
    auditLog,
    notificationDrafts,
    accountId,
    authMode,
    generatedAt,
  });

  return NextResponse.json({ ok: true, payload });
}

function parseAuthMode(value: unknown) {
  return value === "email-link" || value === "oauth" ? value : "demo";
}
