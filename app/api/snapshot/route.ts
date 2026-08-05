import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/hermes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  try {
    return NextResponse.json(getSnapshot(request.nextUrl.searchParams.get("board")), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read Hermes data" }, { status: 500 });
  }
}
