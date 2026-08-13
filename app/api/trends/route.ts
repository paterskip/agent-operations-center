import { NextResponse } from "next/server";
import { getTrends } from "@/lib/trends";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json(getTrends());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
