import { NextResponse } from "next/server";
import { getScorecard } from "@/lib/scorecard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json({ scorecard: getScorecard() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Scorecard niedostępny" }, { status: 500 });
  }
}
