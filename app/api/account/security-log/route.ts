import { NextRequest, NextResponse } from "next/server";
import { getAuditLog } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ip(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function GET(request: NextRequest) {
  const username = request.headers.get("remote-user") || "";
  const devAuthDisabled = process.env.NODE_ENV !== "production" && process.env.AOC_DISABLE_AUTH === "true";
  if (!devAuthDisabled && username !== process.env.AOC_USERNAME) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  try {
    return NextResponse.json({
      log: getAuditLog(100),
      currentIp: ip(request),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nie udało się pobrać dziennika audytu." }, { status: 500 });
  }
}
