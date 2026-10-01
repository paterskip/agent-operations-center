import type { NextRequest } from "next/server";

/**
 * CSRF guard for state-changing routes.
 *
 * Two independent checks, because a single one is easy to bypass:
 *   1. `Origin` must match AOC_PUBLIC_URL exactly. Browsers always send it on
 *      cross-origin writes, so a cross-site form/fetch cannot satisfy it.
 *   2. `Sec-Fetch-Site` must not be `cross-site`. This is set by the browser
 *      itself and cannot be forged by page JavaScript, so it still protects
 *      when a proxy strips or rewrites `Origin`.
 *
 * A missing AOC_PUBLIC_URL is a misconfiguration, not a reason to skip the
 * check: without it we fall back to the production origin so a deployment that
 * forgets the variable fails closed rather than accepting every origin.
 */

const FALLBACK_ORIGIN = "https://agents.paterski.com";

export function expectedOrigin(): string {
  return process.env.AOC_PUBLIC_URL || FALLBACK_ORIGIN;
}

export function isSameOriginRequest(request: NextRequest | Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== expectedOrigin()) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  return true;
}

/** 403 response used by every mutating route, with one shared message. */
export const CSRF_REJECTED = { error: "Invalid request origin" } as const;
