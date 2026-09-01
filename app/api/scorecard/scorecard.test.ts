import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetScorecard = vi.hoisted(() => vi.fn());
const mockGetSystemHealth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/scorecard", () => ({
  getScorecard: (...a: unknown[]) => mockGetScorecard(...a),
  getSystemHealth: (...a: unknown[]) => mockGetSystemHealth(...a),
}));

describe("GET /api/scorecard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns scorecard and health with no-store header", async () => {
    mockGetScorecard.mockReturnValue([{ slug: "coder" }]);
    mockGetSystemHealth.mockReturnValue({ activeBoards: 1, totalAgents: 1, completedTasks30: 5 });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.scorecard).toEqual([{ slug: "coder" }]);
    expect(json.health).toEqual({ activeBoards: 1, totalAgents: 1, completedTasks30: 5 });
  });

  it("returns 500 when getScorecard throws", async () => {
    mockGetScorecard.mockImplementation(() => { throw new Error("db"); });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

