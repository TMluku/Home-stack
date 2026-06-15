import { NextResponse } from "next/server";
import { resetServerState } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";

  if (!accountId.trim()) {
    return NextResponse.json({ ok: false, error: "削除するaccountIdを指定してください。", result: null }, { status: 400 });
  }

  const result = await resetServerState(accountId);
  return NextResponse.json({ ok: true, result });
}
