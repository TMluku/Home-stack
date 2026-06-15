import { NextResponse } from "next/server";
import { searchProductPrices } from "@/lib/product-search";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { query?: unknown; itemName?: unknown; category?: unknown } | null;
  const query = [body?.query, body?.itemName, body?.category]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(" ");

  if (!query) {
    return NextResponse.json({ ok: false, error: "検索する商品名を入力してください。" }, { status: 400 });
  }

  const result = await searchProductPrices(query);
  return NextResponse.json({ ok: true, ...result });
}
