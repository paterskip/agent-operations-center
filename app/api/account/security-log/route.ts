import { NextRequest, NextResponse } from "next/server";
import { getSecurityLog, failedAttempts } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ip(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function GET(request: NextRequest) {
  const username = request.headers.get("remote-user") || "";
  if (username !== process.env.AOC_USERNAME) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  try {
    const clientIp = ip(request);
    const log = getSecurityLog(20);
    const attempts = failedAttempts(clientIp);
    const nearLimit = attempts >= 3;

    return NextResponse.json({
      log,
      failedAttempts: attempts,
      nearLimit,
      currentIp: clientIp,
      limits: { maxRetries: 5, windowMinutes: 15, banHours: 1 },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nie udało się pobrać logów bezpieczeństwa." }, { status: 500 });
  }
}
