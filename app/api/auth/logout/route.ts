import { NextResponse } from "next/server";

/**
 * The session is owned by the identity provider, so the app cannot end it.
 *
 * The previous implementation cleared cookies here, which never worked:
 * Authelia issues `aoc_session` for `domain: agents.paterski.com` and this
 * route answers on the container's internal host, so `cookies.delete()`
 * targeted a cookie the browser never held. The panel reported a logout that
 * did not happen while the session kept working for its full lifetime.
 *
 * The only correct way out is to send the browser to Authelia's `/logout`
 * endpoint (`/authelia/logout` here, because the server address is mounted
 * under that subpath). Authelia destroys the session server-side and
 * redirects back to the panel, which re-challenges for credentials.
 */

const FALLBACK_ORIGIN = "https://agents.paterski.com";

function logoutUrl(): string {
  const origin = process.env.AOC_PUBLIC_URL || FALLBACK_ORIGIN;
  return `${origin.replace(/\/+$/, "")}/authelia/logout`;
}

export async function POST() {
  return NextResponse.json(
    { ok: true, redirect: logoutUrl() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  // Convenience for direct navigation (e.g. a bookmarked logout URL).
  return NextResponse.redirect(logoutUrl(), { status: 303 });
}
