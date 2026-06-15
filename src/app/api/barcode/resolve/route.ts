import { NextResponse } from "next/server";
import { baseOffers } from "@/lib/offers";
import { buildStaticProductSearchResult, resolveBarcode } from "@/lib/post-mvp";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { barcode?: unknown; janCode?: unknown } | null;
  const barcode = [body?.barcode, body?.janCode].find((value) => typeof value === "string") as string | undefined;

  if (!barcode?.trim()) {
    return NextResponse.json({ ok: false, error: "JANまたはバーコードを指定してください。", resolution: null }, { status: 400 });
  }

  const resolution = resolveBarcode(barcode);
  const searchQuery = resolution.product?.janCode ?? resolution.corrections[0] ?? resolution.normalized;
  const searchResult = searchQuery ? buildStaticProductSearchResult(searchQuery, baseOffers) : null;

  return NextResponse.json({ ok: true, resolution, searchResult });
}
