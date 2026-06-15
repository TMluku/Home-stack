import { NextResponse } from "next/server";
import { resolveAccountAccess } from "@/lib/account-auth";
import { getServerStateStoreStatus, normalizeAccountId } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" && body.accountId.trim() ? normalizeAccountId(body.accountId) : undefined;
  const status = await getServerStateStoreStatus();
  const access = accountId ? resolveAccountAccess(request, accountId) : undefined;

  if (access && !access.ok) {
    return NextResponse.json({ ok: false, status, error: access.error, context: access.context, account: null }, { status: access.status });
  }

  return NextResponse.json({
    ok: true,
    status,
    account: access?.ok ? { accountId: access.accountId, context: access.context } : accountId ? { accountId } : null,
  });
}
