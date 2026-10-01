import { NextRequest, NextResponse } from "next/server";
import { getAuditLog } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ip(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function GET(request: NextRequest) {
  // proxy.ts resolves the role once and forwards it as `x-user-role`. Read the
  // role rather than re-deriving it from remote-user: an observer account that
  // happened to share AOC_USERNAME would otherwise inherit full audit access,
  // and observers should get 403 (known-but-forbidden) instead of 401.
  const role = request.headers.get("x-user-role");
  const devAuthDisabled = process.env.NODE_ENV !== "production" && process.env.AOC_DISABLE_AUTH === "true";
  if (!devAuthDisabled) {
    if (role === "observer") {
      return NextResponse.json({ error: "Dostęp w trybie tylko do odczytu (Rola: Observer)" }, { status: 403 });
    }
    if (role !== "ceo") {
      return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
    }
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
