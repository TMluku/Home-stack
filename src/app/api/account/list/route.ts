import { NextResponse } from "next/server";
import { getAccountAccessContext } from "@/lib/account-auth";
import { listServerAccounts } from "@/lib/server-state-store";

export async function POST(request: Request) {
  const context = getAccountAccessContext(request);
  if (context.required && !context.accountId) {
    return NextResponse.json({ ok: false, error: "Authenticated account header is required.", context, accounts: [] }, { status: 401 });
  }

  const accounts = await listServerAccounts();
  return NextResponse.json({
    ok: true,
    accounts: context.accountId ? accounts.filter((account) => account.accountId === context.accountId) : accounts,
  });
}
