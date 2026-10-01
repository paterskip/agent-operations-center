import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { CSRF_REJECTED, expectedOrigin, isSameOriginRequest } from "./csrf";

const env = process.env as Record<string, string | undefined>;
let saved: string | undefined;

beforeEach(() => {
  saved = env.AOC_PUBLIC_URL;
  env.AOC_PUBLIC_URL = "https://agents.example.com";
});

afterEach(() => {
  if (saved === undefined) delete env.AOC_PUBLIC_URL;
  else env.AOC_PUBLIC_URL = saved;
});

function req(headers: Record<string, string>) {
  return new NextRequest("https://agents.example.com/api/tasks", { headers });
}

describe("isSameOriginRequest", () => {
  it("accepts a matching origin", () => {
    expect(isSameOriginRequest(req({ origin: "https://agents.example.com" }))).toBe(true);
  });

  it("rejects a foreign origin", () => {
    expect(isSameOriginRequest(req({ origin: "https://evil.example.com" }))).toBe(false);
  });

  it("rejects a missing origin", () => {
    expect(isSameOriginRequest(req({}))).toBe(false);
  });

  it("rejects a sub-path origin that merely shares the prefix", () => {
    expect(isSameOriginRequest(req({ origin: "https://agents.example.com.evil.io" }))).toBe(false);
  });

  it("rejects a matching origin when Sec-Fetch-Site says cross-site", () => {
    // The Origin header alone is not the whole story: a browser always sets
    // Sec-Fetch-Site, and page JavaScript cannot forge it.
    expect(
      isSameOriginRequest(req({ origin: "https://agents.example.com", "sec-fetch-site": "cross-site" }))
    ).toBe(false);
  });

  it("accepts same-origin and same-site fetch metadata", () => {
    expect(
      isSameOriginRequest(req({ origin: "https://agents.example.com", "sec-fetch-site": "same-origin" }))
    ).toBe(true);
    expect(
      isSameOriginRequest(req({ origin: "https://agents.example.com", "sec-fetch-site": "none" }))
    ).toBe(true);
  });
});

describe("expectedOrigin", () => {
  it("uses AOC_PUBLIC_URL when set", () => {
    expect(expectedOrigin()).toBe("https://agents.example.com");
  });

  it("fails closed on a known production origin when unset", () => {
    delete env.AOC_PUBLIC_URL;
    expect(expectedOrigin()).toBe("https://agents.paterski.com");
    // A missing variable must not widen the check to "any origin".
    expect(isSameOriginRequest(req({ origin: "https://evil.example.com" }))).toBe(false);
  });
});

describe("CSRF_REJECTED", () => {
  it("is a stable 403 payload", () => {
    expect(CSRF_REJECTED).toEqual({ error: "Invalid request origin" });
  });
});
