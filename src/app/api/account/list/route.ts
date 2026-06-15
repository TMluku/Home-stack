import { NextResponse } from "next/server";
import { listServerAccounts } from "@/lib/server-state-store";

export async function POST() {
  const accounts = await listServerAccounts();
  return NextResponse.json({ ok: true, accounts });
}
