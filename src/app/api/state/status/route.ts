import { NextResponse } from "next/server";
import { getServerStateStoreStatus, normalizeAccountId } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" && body.accountId.trim() ? normalizeAccountId(body.accountId) : undefined;
  const status = await getServerStateStoreStatus();

  return NextResponse.json({
    ok: true,
    status,
    account: accountId ? { accountId } : null,
  });
}
