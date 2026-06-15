import type { NotificationDraft } from "./post-mvp";
import type { Channel } from "./types";

export type NotificationContactPoints = Partial<Record<Channel, string>>;

export type NotificationJob = {
  id: string;
  accountId: string;
  draftId: string;
  channel: Channel;
  destination?: string;
  status: "queued" | "blocked";
  blockedReason?: "missing-destination";
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  payload: {
    subject: string;
    message: string;
    actionUrl: string;
  };
};

export type NotificationDispatchResult = {
  id: string;
  jobId: string;
  accountId: string;
  channel: Channel;
  destination?: string;
  status: "dry-run" | "skipped" | "failed";
  reason?: "dry-run-only" | "blocked-job" | "missing-destination" | "unsupported-channel";
  provider: "line" | "email" | "webpush" | "none";
  attempts: number;
  dispatchedAt: string;
  payload: NotificationJob["payload"];
};

export type NotificationJobSummary = {
  total: number;
  queued: number;
  blocked: number;
  channels: Partial<Record<Channel, number>>;
};

export type NotificationDispatchSummary = {
  total: number;
  dryRun: number;
  skipped: number;
  failed: number;
  channels: Partial<Record<Channel, number>>;
};

export function buildNotificationJobs({
  accountId,
  drafts,
  contactPoints = {},
  createdAt = new Date().toISOString(),
}: {
  accountId: string;
  drafts: NotificationDraft[];
  contactPoints?: NotificationContactPoints;
  createdAt?: string;
}): NotificationJob[] {
  return drafts.map((draft) => {
    const destination = contactPoints[draft.channel]?.trim();
    const status = destination ? "queued" : "blocked";

    return {
      id: `${accountId}-${draft.id}`,
      accountId,
      draftId: draft.id,
      channel: draft.channel,
      destination,
      status,
      blockedReason: status === "blocked" ? "missing-destination" : undefined,
      attempts: 0,
      maxAttempts: 3,
      createdAt,
      payload: {
        subject: draft.subject,
        message: draft.message,
        actionUrl: draft.actionUrl,
      },
    };
  });
}

export function summarizeNotificationJobs(jobs: NotificationJob[]): NotificationJobSummary {
  return jobs.reduce<NotificationJobSummary>(
    (summary, job) => {
      summary.total += 1;
      summary[job.status] += 1;
      summary.channels[job.channel] = (summary.channels[job.channel] ?? 0) + 1;
      return summary;
    },
    { total: 0, queued: 0, blocked: 0, channels: {} },
  );
}

export function buildNotificationDispatchResults({
  jobs,
  dryRun = true,
  dispatchedAt = new Date().toISOString(),
}: {
  jobs: NotificationJob[];
  dryRun?: boolean;
  dispatchedAt?: string;
}): NotificationDispatchResult[] {
  return jobs.map((job) => {
    const provider = resolveNotificationProvider(job.channel);
    const baseResult = {
      id: `${job.id}-${dryRun ? "dry-run" : "dispatch"}`,
      jobId: job.id,
      accountId: job.accountId,
      channel: job.channel,
      destination: job.destination,
      provider,
      attempts: job.attempts + (job.status === "queued" ? 1 : 0),
      dispatchedAt,
      payload: job.payload,
    };

    if (job.status === "blocked") {
      return {
        ...baseResult,
        status: "skipped",
        reason: job.blockedReason === "missing-destination" ? "missing-destination" : "blocked-job",
      };
    }

    if (!job.destination) {
      return {
        ...baseResult,
        status: "skipped",
        reason: "missing-destination",
      };
    }

    if (provider === "none") {
      return {
        ...baseResult,
        status: "failed",
        reason: "unsupported-channel",
      };
    }

    return {
      ...baseResult,
      status: dryRun ? "dry-run" : "failed",
      reason: dryRun ? "dry-run-only" : "unsupported-channel",
    };
  });
}

export function summarizeNotificationDispatchResults(results: NotificationDispatchResult[]): NotificationDispatchSummary {
  return results.reduce<NotificationDispatchSummary>(
    (summary, result) => {
      summary.total += 1;
      if (result.status === "dry-run") summary.dryRun += 1;
      if (result.status === "skipped") summary.skipped += 1;
      if (result.status === "failed") summary.failed += 1;
      summary.channels[result.channel] = (summary.channels[result.channel] ?? 0) + 1;
      return summary;
    },
    { total: 0, dryRun: 0, skipped: 0, failed: 0, channels: {} },
  );
}

function resolveNotificationProvider(channel: Channel): NotificationDispatchResult["provider"] {
  if (channel === "line") return "line";
  if (channel === "email") return "email";
  if (channel === "webpush") return "webpush";
  return "none";
}
