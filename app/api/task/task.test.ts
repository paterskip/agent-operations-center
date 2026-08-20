import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFindTask = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hermes", () => ({
  findTask: (...a: unknown[]) => mockFindTask(...a),
}));

describe("GET /api/task", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when id param is missing", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3010/api/task");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when task is not found", async () => {
    mockFindTask.mockReturnValue(null);
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3010/api/task?id=t_missing");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns 200 with task and board when found", async () => {
    const dummy = { task: { id: "t_9c18da02", title: "Test Task" }, board: "portfolio" };
    mockFindTask.mockReturnValue(dummy);
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3010/api/task?id=t_9c18da02&board=aoc");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual(dummy);
    expect(mockFindTask).toHaveBeenCalledWith("t_9c18da02", "aoc");
  });
});
