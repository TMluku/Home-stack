import { NextResponse } from "next/server";
import { loadServerState } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";

  if (!accountId.trim()) {
    return NextResponse.json({ ok: false, error: "読み込むaccountIdを指定してください。", stored: null }, { status: 400 });
  }

  const stored = await loadServerState(accountId);
  if (!stored) {
    return NextResponse.json({ ok: false, error: "保存済み状態が見つかりません。", stored: null }, { status: 404 });
  }

  return NextResponse.json({ ok: true, stored });
}
