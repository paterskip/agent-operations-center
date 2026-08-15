import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetTrends = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trends", () => ({ getTrends: (...a: unknown[]) => mockGetTrends(...a) }));

describe("GET /api/trends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns trends data", async () => {
    mockGetTrends.mockReturnValue({ throughput: [], heatmap: [] });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ throughput: [], heatmap: [] });
  });

  it("returns 500 with error message when getTrends throws", async () => {
    mockGetTrends.mockImplementation(() => { throw new Error("db down"); });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db down");
  });

  it("returns 500 for non-Error throw", async () => {
    mockGetTrends.mockImplementation(() => { throw "string error"; });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("unknown");
  });
});
