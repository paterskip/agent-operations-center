import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const env = process.env as Record<string, string | undefined>;

function responseFor(nodeEnv: string) {
  const oldEnv = env.NODE_ENV;
  env.NODE_ENV = nodeEnv;
  const oldUsername = env.AOC_USERNAME;
  env.AOC_USERNAME = "ceo";
  const response = proxy(new NextRequest("https://agents.paterski.com/", {
    headers: { "remote-user": "ceo", "remote-groups": "ceo", "x-real-ip": "test-csp" },
  }));
  env.AOC_USERNAME = oldUsername;
  env.NODE_ENV = oldEnv;
  return response;
}

describe("browser security headers", () => {
  it("uses a per-request script nonce without unsafe-inline or unsafe-eval in production", () => {
    const csp = responseFor("production").headers.get("Content-Security-Policy") || "";
    const scriptSrc = csp.match(/script-src [^;]+/)?.[0] || "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("allows unsafe-eval in development only (React dev mode requirement)", () => {
    const csp = responseFor("development").headers.get("Content-Security-Policy") || "";
    expect(csp).toMatch(/script-src 'self' 'unsafe-eval' 'nonce-[A-Za-z0-9+/=]+'/);
  });
});
