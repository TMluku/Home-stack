import { NextResponse } from "next/server";
import type { AccountProfile } from "@/lib/account-profile";
import { buildAccountProfile } from "@/lib/account-profile";
import { createDefaultState, normalizeState } from "@/lib/demo-state";
import { baseOffers } from "@/lib/offers";
import { buildConditionAuditLog, buildNotificationDrafts, buildServerSyncPayload } from "@/lib/post-mvp";
import { buildReplenishmentQueue, getRecommendedOffers } from "@/lib/replenishment";
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    state?: unknown;
    accountId?: unknown;
    authMode?: unknown;
    email?: unknown;
    provider?: unknown;
    displayName?: unknown;
  } | null;

  const accountProfile = buildOptionalAccountProfile(body);
  const accountId = typeof body?.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : "demo-account";
  const authMode = parseAuthMode(body?.authMode);
  const state = normalizeState(body?.state ?? createDefaultState());
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
    accountProfile,
    generatedAt,
  });

  return NextResponse.json({ ok: true, payload });
}

function parseAuthMode(value: unknown) {
  return value === "email-link" || value === "oauth" ? value : "demo";
}

function buildOptionalAccountProfile(
  body: { email?: unknown; provider?: unknown; displayName?: unknown } | null,
): AccountProfile | undefined {
  if (typeof body?.email !== "string" || !body.email.trim()) return undefined;
  const provider =
    body.provider === "google" || body.provider === "github" || body.provider === "apple" || body.provider === "email"
      ? body.provider
      : "email";
  return buildAccountProfile({
    email: body.email,
    provider,
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
  });
}
