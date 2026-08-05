import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production" && process.env.AOC_DISABLE_AUTH === "true") return NextResponse.next();
  const username = request.headers.get("remote-user");
  const groups = (request.headers.get("remote-groups") || "").split(",").map((value) => value.trim());
  if (username === process.env.AOC_USERNAME && groups.includes("ceo")) return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
