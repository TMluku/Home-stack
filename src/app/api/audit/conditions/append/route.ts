import { NextResponse } from "next/server";
import type { ConditionAuditLogEntry, ServerSyncPayload } from "@/lib/post-mvp";
import { appendAuditEvents } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    eventType?: unknown;
    events?: unknown;
    payload?: unknown;
  } | null;

  const payload = isServerSyncPayload(body?.payload) ? body.payload : undefined;
  const accountId =
    typeof body?.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : (payload?.account.accountId ?? "");
  const events = Array.isArray(body?.events) ? body.events : (payload?.auditLog ?? []);

  if (!accountId || !isAuditEvents(events)) {
    return NextResponse.json({ ok: false, error: "accountIdと監査イベントを指定してください。", appended: [] }, { status: 400 });
  }

  const appended = await appendAuditEvents({
    accountId,
    events,
    eventType: parseEventType(body?.eventType),
  });

  return NextResponse.json({ ok: true, appended });
}

function isServerSyncPayload(value: unknown): value is ServerSyncPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === "post-mvp-sync-v1" && Array.isArray(record.auditLog);
}

function isAuditEvents(value: unknown): value is ConditionAuditLogEntry[] {
  return Array.isArray(value) && value.every((event) => typeof event === "object" && event !== null && "effectivePrice" in event);
}

function parseEventType(value: unknown) {
  return value === "condition-price-ranked" || value === "condition-price-clicked" ? value : "condition-price-exported";
}
