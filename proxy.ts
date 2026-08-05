import { NextRequest, NextResponse } from "next/server";

const rateMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function rateLimited(request: NextRequest): boolean {
  const now = Date.now();
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const entry = rateMap.get(key);
  if (!entry || now > entry.reset) { rateMap.set(key, { count: 1, reset: now + RATE_WINDOW_MS }); return false; }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Clean up stale entries every 2 minutes (unref so it doesn't keep the process alive)
setInterval(() => { const now = Date.now(); for (const [key, entry] of rateMap) if (now > entry.reset) rateMap.delete(key); }, 120_000).unref();

export function proxy(request: NextRequest) {
  if (rateLimited(request)) return new NextResponse("Rate limit exceeded", { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  if (process.env.NODE_ENV !== "production" && process.env.AOC_DISABLE_AUTH === "true") return NextResponse.next();
  const username = request.headers.get("remote-user");
  const groups = (request.headers.get("remote-groups") || "").split(",").map((value) => value.trim());
  if (username === process.env.AOC_USERNAME && groups.includes("ceo")) return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
