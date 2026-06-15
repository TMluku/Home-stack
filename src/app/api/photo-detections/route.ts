import { NextResponse } from "next/server";
import { detectInventoryFromPhoto } from "@/lib/photo-detection";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { imageData?: unknown; dataUrl?: unknown; mimeType?: unknown } | null;
  const imageData = typeof body?.imageData === "string" ? body.imageData : typeof body?.dataUrl === "string" ? body.dataUrl : undefined;
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : undefined;
  const detection = await detectInventoryFromPhoto({ imageData, mimeType });

  return NextResponse.json({ ok: true, detection });
}
