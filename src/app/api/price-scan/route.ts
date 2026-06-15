import { NextResponse } from "next/server";
import { scrapePriceUrl } from "@/lib/price-scraper";

const MAX_URLS = 5;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { urls?: unknown } | null;
  const urls = Array.isArray(body?.urls)
    ? body.urls
        .map((url) => String(url).trim())
        .filter(Boolean)
        .slice(0, MAX_URLS)
    : [];

  if (urls.length === 0) {
    return NextResponse.json({ ok: false, error: "価格を取得するURLを入力してください。", results: [] }, { status: 400 });
  }

  const results = await Promise.all(urls.map((url) => scrapePriceUrl(url)));
  return NextResponse.json({ ok: true, results });
}
