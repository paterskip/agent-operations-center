import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DashboardSnapshot } from "@/lib/types";

const mockGetSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hermes", () => ({
  getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
}));

async function importRoute() {
  return import("./route");
}

const emptyBoardSnapshot = (): DashboardSnapshot => ({
  generatedAt: 1, selectedBoard: "", boards: [], agents: [], tasks: [], activity: [],
});

const mockSnapshot = (): DashboardSnapshot => ({
  generatedAt: 1, selectedBoard: "myboard",
  boards: [{ slug: "myboard", name: "My Board", description: "", icon: "◆", color: "#3b82f6", counts: { running: 0, blocked: 0 }, lastActivityAt: null }],
  agents: [], tasks: [], activity: [],
});

describe("GET /api/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with snapshot and no-store header", async () => {
    mockGetSnapshot.mockReturnValue(mockSnapshot());
    const { GET } = await importRoute();
    const req = new NextRequest("http://localhost/api/snapshot?board=myboard");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockGetSnapshot).toHaveBeenCalledWith("myboard");
    const body = await res.json() as DashboardSnapshot;
    expect(body.selectedBoard).toBe("myboard");
    expect(body.boards[0].slug).toBe("myboard");
  });

  it("empty boards returns 200 (not 500) — empty-state is valid", async () => {
    mockGetSnapshot.mockReturnValue(emptyBoardSnapshot());
    const { GET } = await importRoute();
    const req = new NextRequest("http://localhost/api/snapshot");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as DashboardSnapshot;
    expect(body.boards).toEqual([]);
    expect(body.selectedBoard).toBe("");
  });

  it("returns 500 when hermes throws (genuine fs error)", async () => {
    mockGetSnapshot.mockImplementation(() => { throw new Error("read error"); });
    const { GET } = await importRoute();
    const req = new NextRequest("http://localhost/api/snapshot");
    const res = await GET(req);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("read error");
  });

  it("passes null board param when absent", async () => {
    mockGetSnapshot.mockReturnValue(mockSnapshot());
    const { GET } = await importRoute();
    const req = new NextRequest("http://localhost/api/snapshot");
    await GET(req);
    expect(mockGetSnapshot).toHaveBeenCalledWith(null);
  });
});
