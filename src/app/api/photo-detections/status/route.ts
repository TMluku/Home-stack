import { NextResponse } from "next/server";
import { getPhotoDetectionProviderStatus } from "@/lib/photo-detection";

export async function POST() {
  return NextResponse.json({ ok: true, status: getPhotoDetectionProviderStatus() });
}
