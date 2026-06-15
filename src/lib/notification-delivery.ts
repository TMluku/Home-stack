import nodemailer from "nodemailer";
import webPush, { type PushSubscription } from "web-push";
import {
  buildNotificationDispatchResults,
  getNotificationProviderReadiness,
  type NotificationDispatchResult,
  type NotificationJob,
  type NotificationProviderReadiness,
} from "./notification-jobs";

export async function dispatchNotificationJobs({
  jobs,
  dryRun = true,
  dispatchedAt = new Date().toISOString(),
  providerReadiness = getNotificationProviderReadiness(dispatchedAt),
}: {
  jobs: NotificationJob[];
  dryRun?: boolean;
  dispatchedAt?: string;
  providerReadiness?: NotificationProviderReadiness;
}): Promise<NotificationDispatchResult[]> {
  const planned = buildNotificationDispatchResults({ jobs, dryRun, dispatchedAt, providerReadiness });
  if (dryRun) return planned;

  const delivered: NotificationDispatchResult[] = [];
  for (const result of planned) {
    if (result.status !== "sent") {
      delivered.push(result);
      continue;
    }

    if (result.provider === "line") {
      delivered.push(await sendLinePushMessage(result));
      continue;
    }

    if (result.provider === "email") {
      delivered.push(await sendEmailSmtpMessage(result));
      continue;
    }

    if (result.provider === "webpush") {
      delivered.push(await sendWebPushMessage(result));
      continue;
    }

    delivered.push(result);
  }
  return delivered;
}

async function sendLinePushMessage(result: NotificationDispatchResult): Promise<NotificationDispatchResult> {
  const token = process.env.HOME_STACK_LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token || !result.destination) {
    return { ...result, status: "failed", reason: token ? "missing-destination" : "provider-not-configured" };
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      to: result.destination,
      messages: [
        {
          type: "text",
          text: buildLineMessageText(result.payload),
        },
      ],
    }),
  });

  if (response.ok) {
    return { ...result, status: "sent", deliveryMethod: "line-push-api", providerStatus: response.status };
  }

  return {
    ...result,
    status: "failed",
    reason: "provider-error",
    providerStatus: response.status,
    providerMessage: await response.text().catch(() => response.statusText),
  };
}

async function sendEmailSmtpMessage(result: NotificationDispatchResult): Promise<NotificationDispatchResult> {
  const from = process.env.HOME_STACK_EMAIL_FROM?.trim();
  const transportUrl = process.env.HOME_STACK_EMAIL_TRANSPORT?.trim();
  if (!from || !transportUrl || !result.destination) {
    return { ...result, status: "failed", reason: result.destination ? "provider-not-configured" : "missing-destination" };
  }

  try {
    const transporter = nodemailer.createTransport(transportUrl);
    const info = await transporter.sendMail({
      from,
      to: result.destination,
      subject: result.payload.subject,
      text: buildEmailText(result.payload),
    });

    return {
      ...result,
      status: "sent",
      deliveryMethod: "email-smtp",
      providerMessage: typeof info.messageId === "string" ? info.messageId : undefined,
    };
  } catch (error) {
    return {
      ...result,
      status: "failed",
      reason: "provider-error",
      providerMessage: error instanceof Error ? error.message : "SMTP send failed.",
    };
  }
}

function buildLineMessageText(payload: NotificationJob["payload"]) {
  return [payload.subject, payload.message, payload.actionUrl].filter(Boolean).join("\n").slice(0, 5000);
}

function buildEmailText(payload: NotificationJob["payload"]) {
  return [payload.message, "", payload.actionUrl].filter(Boolean).join("\n");
}

async function sendWebPushMessage(result: NotificationDispatchResult): Promise<NotificationDispatchResult> {
  const publicKey = process.env.HOME_STACK_WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.HOME_STACK_WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.HOME_STACK_WEB_PUSH_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !result.destination) {
    return { ...result, status: "failed", reason: result.destination ? "provider-not-configured" : "missing-destination" };
  }

  const subscription = parseWebPushSubscription(result.destination);
  if (!subscription) {
    return { ...result, status: "failed", reason: "provider-error", providerMessage: "Invalid Web Push subscription JSON." };
  }

  try {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    const response = await webPush.sendNotification(subscription, JSON.stringify(buildWebPushPayload(result.payload)));
    return {
      ...result,
      status: "sent",
      deliveryMethod: "web-push",
      providerStatus: response.statusCode,
      providerMessage: response.headers.location,
    };
  } catch (error) {
    const responseLike = error as { statusCode?: number; body?: string; message?: string };
    return {
      ...result,
      status: "failed",
      reason: "provider-error",
      providerStatus: responseLike.statusCode,
      providerMessage: responseLike.body ?? responseLike.message ?? "Web Push send failed.",
    };
  }
}

function parseWebPushSubscription(value: string): PushSubscription | null {
  try {
    const parsed = JSON.parse(value) as Partial<PushSubscription>;
    if (typeof parsed.endpoint !== "string" || !parsed.keys?.auth || !parsed.keys?.p256dh) return null;
    return parsed as PushSubscription;
  } catch {
    return null;
  }
}

function buildWebPushPayload(payload: NotificationJob["payload"]) {
  return {
    title: payload.subject,
    body: payload.message,
    data: { actionUrl: payload.actionUrl },
  };
}
