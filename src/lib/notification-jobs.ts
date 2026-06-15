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

export type NotificationJobSummary = {
  total: number;
  queued: number;
  blocked: number;
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
