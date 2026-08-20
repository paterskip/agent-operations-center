import { NextRequest, NextResponse } from "next/server";
import { findTask } from "@/lib/hermes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const board = request.nextUrl.searchParams.get("board");
  if (!id) {
    return NextResponse.json({ error: "Brak parametru id zadania" }, { status: 400 });
  }

  const result = findTask(id, board);
  if (!result) {
    return NextResponse.json({ error: "Zadanie nie zostało odnalezione w żadnym boardzie" }, { status: 404 });
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
