import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const username = process.env.AOC_USERNAME;
  const password = process.env.AOC_PASSWORD;
  const explicitlyDisabled = process.env.AOC_DISABLE_AUTH === "true";
  if (explicitlyDisabled && process.env.NODE_ENV !== "production") return NextResponse.next();
  if (!username || !password) return new NextResponse("Dashboard authentication is not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const split = decoded.indexOf(":");
      if (decoded.slice(0, split) === username && decoded.slice(split + 1) === password) return NextResponse.next();
    } catch {}
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Agent Operations Center"', "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
