import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockListIdeas = vi.hoisted(() => vi.fn());
const mockCreateIdea = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn());
const mockDiscoverBoards = vi.hoisted(() => vi.fn());

vi.mock("@/lib/state", () => ({
  listIdeas: (...a: unknown[]) => mockListIdeas(...a),
  createIdea: (...a: unknown[]) => mockCreateIdea(...a),
  audit: (...a: unknown[]) => mockAudit(...a),
}));
vi.mock("@/lib/hermes", () => ({
  discoverBoards: (...a: unknown[]) => mockDiscoverBoards(...a),
}));

describe("GET /api/ideas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ideas with no-store header", async () => {
    mockListIdeas.mockReturnValue([{ id: "idea-1", title: "Test" }]);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.ideas).toEqual([{ id: "idea-1", title: "Test" }]);
  });

  it("returns 500 when listIdeas throws", async () => {
    mockListIdeas.mockImplementation(() => { throw new Error("db"); });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/ideas", () => {
  beforeEach(() => {
    vi.stubEnv("AOC_PUBLIC_URL", "https://agents.example.com");
    vi.clearAllMocks();
  });

  function makeReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/ideas", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("403 on origin mismatch", async () => {
    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/api/ideas", {
      method: "POST", headers: { origin: "https://evil.com", "content-type": "application/json" }, body: "{}",
    }));
    expect(res.status).toBe(403);
  });

  it("415 when content-type not JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/api/ideas", {
      method: "POST", headers: { origin: "https://agents.example.com" }, body: "x",
    }));
    expect(res.status).toBe(415);
  });

  it("413 when body over 12000 chars", async () => {
    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/api/ideas", {
      method: "POST", headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ title: "t".repeat(100), description: "x".repeat(100), project: "proj", priority: 1, mode: "draft" }),
    }));
    expect(res.status).not.toBe(413);
    // Now test actual oversized
    const bigRes = await POST(new NextRequest("http://localhost/api/ideas", {
      method: "POST", headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ title: "t".repeat(100), description: "x".repeat(12_001), project: "proj", priority: 1, mode: "draft" }),
    }));
    expect(bigRes.status).toBe(413);
  });

  it("400 on title too short", async () => {
    mockDiscoverBoards.mockReturnValue([{ slug: "proj" }]);
    const { POST } = await import("./route");
    const res = await POST(makeReq({ title: "ab", description: "x".repeat(50), project: "proj", priority: 1, mode: "draft" }));
    expect(res.status).toBe(400);
  });

  it("400 on description too short", async () => {
    mockDiscoverBoards.mockReturnValue([{ slug: "proj" }]);
    const { POST } = await import("./route");
    const res = await POST(makeReq({ title: "Dobry tytuł", description: "short", project: "proj", priority: 1, mode: "draft" }));
    expect(res.status).toBe(400);
  });

  it("400 on unknown project", async () => {
    mockDiscoverBoards.mockReturnValue([{ slug: "proj" }]);
    const { POST } = await import("./route");
    const res = await POST(makeReq({ title: "Dobry tytuł", description: "x".repeat(50), project: "nope", priority: 1, mode: "draft" }));
    expect(res.status).toBe(400);
  });

  it("400 on invalid priority/mode", async () => {
    mockDiscoverBoards.mockReturnValue([{ slug: "proj" }]);
    const { POST } = await import("./route");
    const res = await POST(makeReq({ title: "Dobry tytuł", description: "x".repeat(50), project: "proj", priority: 99, mode: "bad" }));
    expect(res.status).toBe(400);
  });

  it("201 on valid idea with mode=draft", async () => {
    mockDiscoverBoards.mockReturnValue([{ slug: "proj" }]);
    mockCreateIdea.mockReturnValue({ id: "idea-1", title: "T", status: "draft" });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ title: "Nowy pomysł", description: "Szczegółowy opis pomysłu do analizy", project: "proj", priority: 2, mode: "draft" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockCreateIdea).toHaveBeenCalledWith(expect.objectContaining({ mode: "draft" }));
    expect(mockAudit).toHaveBeenCalledWith("ceo", "idea.draft", "idea-1", "proj", expect.any(String));
  });

  it("201 on valid idea with mode=analysis", async () => {
    mockDiscoverBoards.mockReturnValue([{ slug: "proj" }]);
    mockCreateIdea.mockReturnValue({ id: "idea-2", title: "T", status: "queued" });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ title: "Inny pomysł", description: "Szczegółowy opis pomysłu do analizy", project: "proj", priority: 3, mode: "analysis" }));
    expect(res.status).toBe(201);
    expect(mockAudit).toHaveBeenCalledWith("ceo", "idea.submit", "idea-2", "proj", expect.any(String));
  });

  it("500 when createIdea throws", async () => {
    mockDiscoverBoards.mockReturnValue([{ slug: "proj" }]);
    mockCreateIdea.mockImplementation(() => { throw new Error("db"); });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ title: "Nowy pomysł", description: "Szczegółowy opis pomysłu do analizy", project: "proj", priority: 2, mode: "draft" }));
    expect(res.status).toBe(500);
  });
});
