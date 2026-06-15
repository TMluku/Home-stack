import { NextResponse } from "next/server";
import type { ServerSyncPayload } from "@/lib/post-mvp";
import { saveServerState } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { payload?: unknown } | null;
  const payload = body?.payload;

  if (!isServerSyncPayload(payload)) {
    return NextResponse.json({ ok: false, error: "保存する同期payloadを指定してください。", stored: null }, { status: 400 });
  }

  const stored = await saveServerState(payload);
  return NextResponse.json({ ok: true, stored });
}

function isServerSyncPayload(value: unknown): value is ServerSyncPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const account = record.account as Record<string, unknown> | undefined;
  return (
    record.schemaVersion === "post-mvp-sync-v1" &&
    Boolean(account?.accountId) &&
    Array.isArray(record.auditLog) &&
    Array.isArray(record.notificationDrafts) &&
    Boolean(record.state)
  );
}
