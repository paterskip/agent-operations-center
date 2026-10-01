import { NextResponse } from "next/server";

/**
 * Clears the session cookies issued by the identity provider.
 *
 * The app never sets these cookies itself — Authelia issues `aoc_session` for
 * the apex domain. `cookies.delete()` without an explicit `domain` targets the
 * request host only, so it silently failed to remove the real cookie. The
 * path must match too, otherwise the browser keeps a more specific copy.
 */

const SESSION_COOKIES = ["aoc_session", "session", "token"] as const;

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true, message: "Logged out successfully" });
  const host = new URL(request.url).hostname;

  for (const name of SESSION_COOKIES) {
    for (const domain of [host, `.${host}`]) {
      response.cookies.set(name, "", { domain, path: "/", maxAge: 0 });
    }
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
