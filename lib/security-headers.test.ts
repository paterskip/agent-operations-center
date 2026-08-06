import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

describe("browser security headers", () => {
  it("uses a per-request script nonce without unsafe-inline", () => {
    const oldUsername = process.env.AOC_USERNAME;
    process.env.AOC_USERNAME = "ceo";
    const response = proxy(new NextRequest("https://agents.paterski.com/", {
      headers: { "remote-user": "ceo", "remote-groups": "ceo", "x-real-ip": "test-csp" },
    }));
    const csp = response.headers.get("Content-Security-Policy");
    process.env.AOC_USERNAME = oldUsername;

    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
