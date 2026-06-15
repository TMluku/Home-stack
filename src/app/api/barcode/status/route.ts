import { NextResponse } from "next/server";
import { getBarcodeMasterStatus } from "@/lib/barcode-master";

export async function POST() {
  return NextResponse.json({
    ok: true,
    status: getBarcodeMasterStatus(),
  });
}
