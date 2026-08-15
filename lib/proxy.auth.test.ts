import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const env = process.env as Record<string, string | undefined>;

function withEnv(patch: Record<string, string | undefined>) {
  const old = { NODE_ENV: env.NODE_ENV, AOC_DISABLE_AUTH: env.AOC_DISABLE_AUTH, AOC_USERNAME: env.AOC_USERNAME };
  Object.assign(env, patch);
  return () => Object.assign(env, old);
}

function req(overrides: Record<string, string> = {}) {
  const headers: Record<string, string> = { "x-real-ip": `ip-${Math.random().toString(36).slice(2)}`, ...overrides };
  return new NextRequest("https://agents.paterski.com/", { headers });
}

describe("proxy auth", () => {
  it("fails closed when remote-user header missing (production)", () => {
    const restore = withEnv({ NODE_ENV: "production", AOC_USERNAME: "ceo" });
    try {
      const res = proxy(req());
      expect(res.status).toBe(401);
      expect(res.headers.get("Content-Security-Policy")).toContain("'self'");
    } finally { restore(); }
  });

  it("passes when remote-user === AOC_USERNAME and groups include ceo (production)", () => {
    const restore = withEnv({ NODE_ENV: "production", AOC_USERNAME: "ceo" });
    try {
      const res = proxy(req({ "remote-user": "ceo", "remote-groups": "ceo" }));
      // NextResponse.next() returns a response with the request headers merged; status 200
      expect(res.status).toBe(200);
    } finally { restore(); }
  });

  it("rejects wrong username (production)", () => {
    const restore = withEnv({ NODE_ENV: "production", AOC_USERNAME: "ceo" });
    try {
      const res = proxy(req({ "remote-user": "attacker", "remote-groups": "ceo" }));
      expect(res.status).toBe(401);
    } finally { restore(); }
  });

  it("rejects correct user without ceo group (production)", () => {
    const restore = withEnv({ NODE_ENV: "production", AOC_USERNAME: "ceo" });
    try {
      const res = proxy(req({ "remote-user": "ceo", "remote-groups": "viewer" }));
      expect(res.status).toBe(401);
    } finally { restore(); }
  });

  it("allows dev bypass when AOC_DISABLE_AUTH=true and NODE_ENV!=production", () => {
    const restore = withEnv({ NODE_ENV: "development", AOC_DISABLE_AUTH: "true", AOC_USERNAME: "ceo" });
    try {
      const res = proxy(req());
      expect(res.status).toBe(200);
    } finally { restore(); }
  });

  it("does NOT allow dev bypass in production even if AOC_DISABLE_AUTH=true", () => {
    const restore = withEnv({ NODE_ENV: "production", AOC_DISABLE_AUTH: "true", AOC_USERNAME: "ceo" });
    try {
      const res = proxy(req());
      expect(res.status).toBe(401);
    } finally { restore(); }
  });
});

describe("proxy rate limiting", () => {
  it("returns 429 after 60 requests from the same IP within the window", () => {
    const restore = withEnv({ NODE_ENV: "production", AOC_USERNAME: "ceo" });
    try {
      const ip = `rate-ip-${Math.random().toString(36).slice(2)}`;
      for (let i = 0; i < 60; i++) {
        const res = proxy(new NextRequest("https://agents.paterski.com/", { headers: { "x-real-ip": ip, "remote-user": "ceo", "remote-groups": "ceo" } }));
        expect(res.status).toBe(200);
      }
      // 61st should be rate limited
      const limited = proxy(new NextRequest("https://agents.paterski.com/", { headers: { "x-real-ip": ip, "remote-user": "ceo", "remote-groups": "ceo" } }));
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBe("60");
    } finally { restore(); }
  });
});
