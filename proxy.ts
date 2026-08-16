import { NextRequest, NextResponse } from "next/server";

const rateMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_ENTRIES = 5_000;

function contentSecurityPolicy(nonce: string) {
  // React dev mode requires eval (HMR, devtools callstack reconstruction); production never gets it.
  const scriptSrc = process.env.NODE_ENV !== "production" ? `'self' 'unsafe-eval' 'nonce-${nonce}'` : `'self' 'nonce-${nonce}'`;
  return `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src ${scriptSrc}; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`;
}

function denied(body: string, status: number, csp: string, headers: Record<string, string> = {}) {
  return new NextResponse(body, { status, headers: { ...headers, "Cache-Control": "no-store", "Content-Security-Policy": csp } });
}

function rateLimited(request: NextRequest): boolean {
  const now = Date.now();
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const entry = rateMap.get(key);
  if (!entry || now > entry.reset) {
    if (rateMap.size >= MAX_RATE_ENTRIES) {
      // LRU eviction: remove the oldest 500 entries when capacity is reached
      let removed = 0;
      for (const k of rateMap.keys()) {
        rateMap.delete(k);
        if (++removed >= 500) break;
      }
    }
    rateMap.set(key, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Clean up stale entries every 2 minutes (unref so it doesn't keep the process alive)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) if (now > entry.reset) rateMap.delete(key);
}, 120_000).unref();

export function proxy(request: NextRequest) {
  // Next.js reads the request CSP nonce and adds it to its inline bootstrap
  // scripts. Without those scripts React cannot hydrate and the loader never ends.
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  if (rateLimited(request)) return denied("Rate limit exceeded", 429, csp, { "Retry-After": "60" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const pass = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  if (process.env.NODE_ENV !== "production" && process.env.AOC_DISABLE_AUTH === "true") return pass();
  const username = request.headers.get("remote-user");
  const groups = (request.headers.get("remote-groups") || "").split(",").map((value) => value.trim());
  if (username === process.env.AOC_USERNAME && groups.includes("ceo")) return pass();
  return denied("Authentication required", 401, csp);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
