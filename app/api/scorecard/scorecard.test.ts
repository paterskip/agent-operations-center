import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetScorecard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/scorecard", () => ({ getScorecard: (...a: unknown[]) => mockGetScorecard(...a) }));

describe("GET /api/scorecard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns scorecard with no-store header", async () => {
    mockGetScorecard.mockReturnValue({ agents: [], boardStats: {} });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).scorecard).toEqual({ agents: [], boardStats: {} });
  });

  it("returns 500 when getScorecard throws", async () => {
    mockGetScorecard.mockImplementation(() => { throw new Error("db"); });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
