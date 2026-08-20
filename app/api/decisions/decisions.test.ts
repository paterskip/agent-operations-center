import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockListDecisions = vi.hoisted(() => vi.fn());
const mockEnqueueDecision = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn());
const mockGetSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/state", () => ({
  listDecisions: (...a: unknown[]) => mockListDecisions(...a),
  enqueueDecision: (...a: unknown[]) => mockEnqueueDecision(...a),
  audit: (...a: unknown[]) => mockAudit(...a),
}));

vi.mock("@/lib/hermes", () => ({
  getSnapshot: (...a: unknown[]) => mockGetSnapshot(...a),
}));

describe("GET /api/decisions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns decisions list with no-store cache header", async () => {
    mockListDecisions.mockReturnValue([{ id: "dec-1", action: "approve" }]);
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3010/api/decisions");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.decisions).toEqual([{ id: "dec-1", action: "approve" }]);
  });
});

describe("POST /api/decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AOC_PUBLIC_URL = "http://localhost:3010";
  });

  it("enqueues approve decision on blocked task successfully", async () => {
    mockGetSnapshot.mockReturnValue({
      selectedBoard: "main-board",
      tasks: [{ id: "T-100", status: "blocked" }],
    });
    mockEnqueueDecision.mockReturnValue({ id: "dec-1", status: "queued" });

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3010/api/decisions", {
      method: "POST",
      headers: {
        origin: "http://localhost:3010",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        board: "main-board",
        taskId: "T-100",
        action: "approve",
        comment: "LGTM unblock task",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(mockEnqueueDecision).toHaveBeenCalledWith({
      board: "main-board",
      taskId: "T-100",
      action: "approve",
      fromStatus: "blocked",
      toStatus: null,
      comment: "LGTM unblock task",
    });
  });

  it("rejects action if task status is not allowed by policy", async () => {
    mockGetSnapshot.mockReturnValue({
      selectedBoard: "main-board",
      tasks: [{ id: "T-100", status: "done" }],
    });

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3010/api/decisions", {
      method: "POST",
      headers: {
        origin: "http://localhost:3010",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        board: "main-board",
        taskId: "T-100",
        action: "approve",
        comment: "Try unblocking done task",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("nie jest dozwolona dla statusu done");
  });
});
