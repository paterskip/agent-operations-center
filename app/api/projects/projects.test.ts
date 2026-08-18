import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/hermes", () => ({
  discoverBoards: vi.fn(() => [
    { slug: "aoc", name: "Agent Operations Center", icon: "◈", color: "", dbPath: "/mock/aoc.db" },
    { slug: "typer-bot", name: "TyperBot", icon: "⌨", color: "", dbPath: "/mock/typer.db" },
  ]),
}));

vi.mock("@/lib/state", () => ({
  enqueueProjectCreate: vi.fn(({ slug, name }) => ({ id: "proj_123", slug, status: "pending" })),
  audit: vi.fn(),
}));

describe("Projects API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns all discovered projects", () => {
    const res = GET();
    expect(res.status).toBe(200);
  });

  it("POST creates a new valid project", async () => {
    const req = new NextRequest("https://agents.paterski.com/api/projects", {
      method: "POST",
      headers: {
        origin: "https://agents.paterski.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Super Aplikacja",
        slug: "super-aplikacja",
        description: "Nowy moduł w systemie",
        icon: "🚀",
        color: "#d4ff00",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("super-aplikacja");
  });

  it("POST rejects forbidden/reserved slugs", async () => {
    const req = new NextRequest("https://agents.paterski.com/api/projects", {
      method: "POST",
      headers: {
        origin: "https://agents.paterski.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Overview Module",
        slug: "overview",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("zastrzeżony");
  });

  it("POST rejects duplicate existing slugs", async () => {
    const req = new NextRequest("https://agents.paterski.com/api/projects", {
      method: "POST",
      headers: {
        origin: "https://agents.paterski.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Duplicate AOC",
        slug: "aoc",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("już istnieje");
  });
});
