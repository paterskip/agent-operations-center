import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DashboardSnapshot } from "@/lib/types";

const mockGetSnapshot = vi.hoisted(() => vi.fn());
const mockEnqueueMove = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hermes", () => ({
  getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
}));

vi.mock("@/lib/state", () => ({
  enqueueMove: (...args: unknown[]) => mockEnqueueMove(...args),
  audit: (...args: unknown[]) => mockAudit(...args),
}));

const baseSnapshot: DashboardSnapshot = {
  generatedAt: 1,
  selectedBoard: "myboard",
  boards: [
    {
      slug: "myboard",
      name: "My Board",
      description: "",
      icon: "◆",
      color: "#0",
      counts: { running: 1, blocked: 0 },
      lastActivityAt: null,
    },
  ],
  agents: [],
  tasks: [
    {
      id: "T-100",
      boardSlug: "myboard",
      title: "Task 100",
      body: "",
      assignee: "coder",
      status: "running",
      priority: 2,
      createdAt: 1,
      startedAt: 1,
      completedAt: null,
      branchName: null,
      result: null,
      blockKind: null,
      lastHeartbeatAt: null,
      modelOverride: null,
      attachmentCount: 0,
      parentIds: [],
      childIds: [],
      comments: [],
      runs: [],
    },
  ],
  activity: [],
};

function makeReq(body: unknown, origin = "https://agents.paterski.com") {
  return new NextRequest("http://localhost/api/comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/comments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 on invalid origin", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", taskId: "T-100", comment: "Test note" }, "https://malicious.com"));
    expect(res.status).toBe(403);
  });

  it("returns 400 on comment too short", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", taskId: "T-100", comment: "x" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 on unknown board or task", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot);
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "otherboard", taskId: "T-100", comment: "Valid comment" }));
    expect(res.status).toBe(404);
  });

  it("returns 202 and enqueues move comment on success", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot);
    mockEnqueueMove.mockReturnValue({ id: "move_comment_123", status: "queued" });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", taskId: "T-100", comment: "Please check DB migrations" }));
    expect(res.status).toBe(202);
    expect(mockEnqueueMove).toHaveBeenCalledWith({
      action: "comment",
      board: "myboard",
      taskId: "T-100",
      comment: "Please check DB migrations",
    });
    expect(mockAudit).toHaveBeenCalled();
  });
});
