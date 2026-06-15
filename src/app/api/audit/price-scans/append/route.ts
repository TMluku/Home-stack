import { NextResponse } from "next/server";
import { resolveAccountAccess } from "@/lib/account-auth";
import { buildLivePriceConditionAuditLog } from "@/lib/post-mvp";
import { appendAuditEvents } from "@/lib/server-state-store";
import type { LivePriceResult } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    results?: unknown;
    generatedAt?: unknown;
  } | null;

  const accountId = typeof body?.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : "";
  const results = isLivePriceResults(body?.results) ? body.results : [];
  const generatedAt = typeof body?.generatedAt === "string" && body.generatedAt.trim() ? body.generatedAt : undefined;

  if (!accountId || results.length === 0) {
    return NextResponse.json({ ok: false, error: "accountId and live price scan results are required.", appended: [] }, { status: 400 });
  }

  const access = resolveAccountAccess(request, accountId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error, context: access.context, appended: [] }, { status: access.status });
  }

  const events = buildLivePriceConditionAuditLog({ results, generatedAt });
  if (events.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No successful price-bearing scan results were available for audit.", appended: [] },
      { status: 400 },
    );
  }

  const appended = await appendAuditEvents({
    accountId: access.accountId,
    events,
    eventType: "condition-price-ranked",
  });

  return NextResponse.json({ ok: true, appended });
}

function isLivePriceResults(value: unknown): value is LivePriceResult[] {
  return (
    Array.isArray(value) &&
    value.every((result) => {
      if (!result || typeof result !== "object") return false;
      const record = result as Record<string, unknown>;
      return typeof record.url === "string" && typeof record.ok === "boolean" && typeof record.source === "string";
    })
  );
}
