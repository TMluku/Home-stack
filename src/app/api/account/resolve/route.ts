import { NextResponse } from "next/server";
import type { AccountProfile } from "@/lib/account-profile";
import { buildAccountProfile } from "@/lib/account-profile";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    provider?: unknown;
    displayName?: unknown;
  } | null;

  const email = typeof body?.email === "string" ? body.email : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName : undefined;
  const provider = parseProvider(body?.provider);
  const profile = buildAccountProfile({ email, provider, displayName });

  return NextResponse.json({ ok: true, profile });
}

function parseProvider(value: unknown): AccountProfile["provider"] {
  return value === "google" || value === "github" || value === "apple" || value === "email" ? value : "email";
}
