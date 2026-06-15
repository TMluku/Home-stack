import nodemailer from "nodemailer";
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
