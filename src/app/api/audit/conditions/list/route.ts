import { NextResponse } from "next/server";
import { resolveAccountAccess } from "@/lib/account-auth";
import { listAuditEvents } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";

  if (!accountId.trim()) {
    return NextResponse.json({ ok: false, error: "読み込むaccountIdを指定してください。", events: [] }, { status: 400 });
  }

  const access = resolveAccountAccess(request, accountId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error, context: access.context, events: [] }, { status: access.status });
  }

  const events = await listAuditEvents(access.accountId);
  return NextResponse.json({ ok: true, events });
}
