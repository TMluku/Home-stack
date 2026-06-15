import { NextResponse } from "next/server";
import { getNotificationProviderReadiness } from "@/lib/notification-jobs";

export async function POST() {
  return NextResponse.json({ ok: true, readiness: getNotificationProviderReadiness() });
}
