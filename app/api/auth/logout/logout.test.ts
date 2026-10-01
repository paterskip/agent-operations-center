import { describe, it, expect, afterEach } from "vitest";
import { POST, GET } from "./route";

const env = process.env as Record<string, string | undefined>;
let saved: string | undefined;

afterEach(() => {
  if (saved === undefined) delete env.AOC_PUBLIC_URL;
  else env.AOC_PUBLIC_URL = saved;
  saved = undefined;
});

describe("POST /api/auth/logout", () => {
  it("returns the identity provider logout URL for the configured origin", async () => {
    saved = env.AOC_PUBLIC_URL;
    env.AOC_PUBLIC_URL = "https://agents.example.com";
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirect).toBe("https://agents.example.com/authelia/logout");
  });

  it("strips a trailing slash from the configured origin", async () => {
    saved = env.AOC_PUBLIC_URL;
    env.AOC_PUBLIC_URL = "https://agents.example.com/";
    const res = await POST();
    const body = await res.json();
    expect(body.redirect).toBe("https://agents.example.com/authelia/logout");
  });

  it("falls back to the production origin when unset", async () => {
    saved = env.AOC_PUBLIC_URL;
    delete env.AOC_PUBLIC_URL;
    const res = await POST();
    const body = await res.json();
    expect(body.redirect).toBe("https://agents.paterski.com/authelia/logout");
  });

  it("does not emit Set-Cookie for session cookies", async () => {
    // The app cannot clear a cookie it did not issue: Authelia sets
    // `aoc_session` for the browser's domain while this route answers on the
    // container's internal host. Ending the session is Authelia's job.
    saved = env.AOC_PUBLIC_URL;
    env.AOC_PUBLIC_URL = "https://agents.example.com";
    const res = await POST();
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie === null || !/aoc_session/.test(setCookie)).toBe(true);
  });
});

describe("GET /api/auth/logout", () => {
  it("redirects to the identity provider logout endpoint", async () => {
    saved = env.AOC_PUBLIC_URL;
    env.AOC_PUBLIC_URL = "https://agents.example.com";
    const res = await GET();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://agents.example.com/authelia/logout");
  });
});
