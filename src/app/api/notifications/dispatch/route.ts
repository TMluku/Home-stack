import { NextResponse } from "next/server";
import type { NotificationContactPoints, NotificationJob } from "@/lib/notification-jobs";
import {
  buildNotificationDispatchResults,
  buildNotificationJobs,
  getNotificationProviderReadiness,
  summarizeNotificationDispatchResults,
} from "@/lib/notification-jobs";
import type { ServerSyncPayload } from "@/lib/post-mvp";
import { appendNotificationEvent } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    payload?: unknown;
    jobs?: unknown;
    contactPoints?: NotificationContactPoints;
    dryRun?: unknown;
    dispatchedAt?: unknown;
  } | null;

  const jobs = isNotificationJobs(body?.jobs)
    ? body.jobs
    : isServerSyncPayload(body?.payload)
      ? buildNotificationJobs({
          accountId: body.payload.account.accountId,
          drafts: body.payload.notificationDrafts,
          contactPoints: body.contactPoints,
        })
      : [];

  if (jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Notification jobs or a sync payload are required.", results: [], summary: null },
      { status: 400 },
    );
  }

  const dryRun = body?.dryRun !== false;
  const dispatchedAt = typeof body?.dispatchedAt === "string" && body.dispatchedAt.trim() ? body.dispatchedAt : undefined;
  const readiness = getNotificationProviderReadiness(dispatchedAt);
  const results = buildNotificationDispatchResults({ jobs, dryRun, dispatchedAt, providerReadiness: readiness });
  const summary = summarizeNotificationDispatchResults(results);
  const event = await appendNotificationEvent({
    accountId: jobs[0].accountId,
    eventType: "notification-dispatched",
    appendedAt: results[0]?.dispatchedAt ?? new Date().toISOString(),
    dryRun,
    results,
    summary,
  });

  return NextResponse.json({ ok: true, dryRun, readiness, results, summary, event });
}

function isServerSyncPayload(value: unknown): value is ServerSyncPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const account = record.account as Record<string, unknown> | undefined;
  return record.schemaVersion === "post-mvp-sync-v1" && typeof account?.accountId === "string" && Array.isArray(record.notificationDrafts);
}

function isNotificationJobs(value: unknown): value is NotificationJob[] {
  return (
    Array.isArray(value) &&
    value.every((job) => {
      if (!job || typeof job !== "object") return false;
      const record = job as Record<string, unknown>;
      return typeof record.id === "string" && typeof record.accountId === "string" && typeof record.channel === "string";
    })
  );
}
