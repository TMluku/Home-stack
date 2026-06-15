import { NextResponse } from "next/server";
import type { NotificationContactPoints } from "@/lib/notification-jobs";
import { buildNotificationJobs, getNotificationProviderReadiness, summarizeNotificationJobs } from "@/lib/notification-jobs";
import type { ServerSyncPayload } from "@/lib/post-mvp";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    payload?: unknown;
    contactPoints?: NotificationContactPoints;
  } | null;

  if (!isServerSyncPayload(body?.payload)) {
    return NextResponse.json(
      { ok: false, error: "通知準備に使う同期payloadを指定してください。", jobs: [], summary: null },
      { status: 400 },
    );
  }

  const jobs = buildNotificationJobs({
    accountId: body.payload.account.accountId,
    drafts: body.payload.notificationDrafts,
    contactPoints: body?.contactPoints,
  });

  return NextResponse.json({ ok: true, jobs, readiness: getNotificationProviderReadiness(), summary: summarizeNotificationJobs(jobs) });
}

function isServerSyncPayload(value: unknown): value is ServerSyncPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const account = record.account as Record<string, unknown> | undefined;
  return record.schemaVersion === "post-mvp-sync-v1" && typeof account?.accountId === "string" && Array.isArray(record.notificationDrafts);
}
