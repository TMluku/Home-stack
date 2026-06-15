import { NextResponse } from "next/server";
import { buildCandidateConditionAuditLog } from "@/lib/post-mvp";
import { appendAuditEvents } from "@/lib/server-state-store";
import type { ProductSearchCandidate, ProductSearchResult } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    candidates?: unknown;
    result?: unknown;
    searchResult?: unknown;
    generatedAt?: unknown;
  } | null;

  const accountId = typeof body?.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : "";
  const result = isProductSearchResult(body?.result)
    ? body.result
    : isProductSearchResult(body?.searchResult)
      ? body.searchResult
      : undefined;
  const candidates = isProductSearchCandidates(body?.candidates) ? body.candidates : (result?.candidates ?? []);
  const generatedAt = typeof body?.generatedAt === "string" && body.generatedAt.trim() ? body.generatedAt : undefined;

  if (!accountId || candidates.length === 0) {
    return NextResponse.json({ ok: false, error: "accountId and search candidates are required.", appended: [] }, { status: 400 });
  }

  const events = buildCandidateConditionAuditLog({
    candidates,
    generatedAt,
    sourceQuery: result?.normalizedQuery ?? result?.query,
  });

  if (events.length === 0) {
    return NextResponse.json({ ok: false, error: "No price-bearing candidates were available for audit.", appended: [] }, { status: 400 });
  }

  const appended = await appendAuditEvents({
    accountId,
    events,
    eventType: "condition-price-ranked",
  });

  return NextResponse.json({ ok: true, appended });
}

function isProductSearchResult(value: unknown): value is ProductSearchResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.query === "string" && Array.isArray(record.candidates);
}

function isProductSearchCandidates(value: unknown): value is ProductSearchCandidate[] {
  return (
    Array.isArray(value) &&
    value.every((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const record = candidate as Record<string, unknown>;
      return typeof record.id === "string" && typeof record.title === "string" && typeof record.url === "string";
    })
  );
}
