import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DashboardSnapshot, TaskCard } from "@/lib/types";

const mockGetSnapshot = vi.hoisted(() => vi.fn());
const mockEnqueueMove = vi.hoisted(() => vi.fn());
const mockListMoves = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn());
const mockIsAllowedMove = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hermes", () => ({ getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args) }));
vi.mock("@/lib/state", () => ({ enqueueMove: (...a: unknown[]) => mockEnqueueMove(...a), listMoves: (...a: unknown[]) => mockListMoves(...a), audit: (...a: unknown[]) => mockAudit(...a) }));
vi.mock("@/lib/transitions", () => ({
  isAllowedMove: (...a: unknown[]) => mockIsAllowedMove(...a),
  ALLOWED_DROPS: { triage: [], todo: ["scheduled"], scheduled: [], ready: ["running"], running: ["blocked", "review"], blocked: [], review: ["ready"], done: [] },
}));
vi.mock("@/lib/types", () => ({
  STATUSES: ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"],
  createEmptySnapshot: () => ({ generatedAt: 0, selectedBoard: "", boards: [], agents: [], tasks: [], activity: [] }),
}));

const createTestTask = (id: string, status: string): TaskCard => ({
  id,
  title: `Task ${id}`,
  body: "Test Body",
  assignee: null,
  status,
  priority: 2,
  createdAt: 0,
  startedAt: null,
  completedAt: null,
  branchName: null,
  result: null,
  blockKind: null,
  lastHeartbeatAt: null,
  modelOverride: null,
  boardSlug: "myboard",
  parentIds: [],
  childIds: [],
  comments: [],
  runs: [],
  attachmentCount: 0,
});

const baseSnapshot = (tasks: TaskCard[] = []): DashboardSnapshot => ({
  generatedAt: 1, selectedBoard: "myboard",
  boards: [{ slug: "myboard", name: "My Board", description: "", icon: "◆", color: "#0", counts: { running: 0, blocked: 0 }, lastActivityAt: null }],
  agents: [], tasks, activity: [],
});

describe("GET /api/tasks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns moves list with no-store", async () => {
    mockListMoves.mockReturnValue([{ id: "m1", board: "myboard", taskId: "T-1", action: "move", fromStatus: "todo", toStatus: "scheduled", title: "t", body: "b", assignee: "pm", priority: 2, comment: "", status: "done", resultStatus: "scheduled", lastError: null, createdAt: 0, updatedAt: 0 }]);
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/tasks?board=myboard&taskId=T-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.json()).resolves.toMatchObject({ moves: [{ id: "m1" }] });
  });

  it("returns 500 when listMoves throws", async () => {
    mockListMoves.mockImplementation(() => { throw new Error("db down"); });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/tasks"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/tasks — create new task", () => {
  beforeEach(() => vi.clearAllMocks());
  const makeReq = (body: unknown, origin = "https://agents.paterski.com") =>
    new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });

  it("rejects mismatched origin with 403", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard" }, "https://evil.com"));
    expect(res.status).toBe(403);
  });

  it("rejects non-json content type with 415", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/tasks", { method: "POST", headers: { origin: "https://agents.paterski.com" } });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("rejects payload with invalid board name with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "INVALID BOARD", title: "Valid Title", body: "Valid description body long enough", priority: 2 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("board");
  });

  it("rejects too short title with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", title: "ab", body: "Valid description body long enough", priority: 2 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Tytuł");
  });

  it("rejects too short description with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", title: "Valid Title", body: "short", priority: 2 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Opis");
  });

  it("rejects invalid priority with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", title: "Valid Title", body: "Valid description body long enough", priority: 99 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Nieprawidłowe");
  });

  it("returns 404 when board does not exist", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([]));
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "otherboard", title: "Valid Title", body: "Valid description body long enough", priority: 2 }));
    expect(res.status).toBe(404);
  });

  it("creates task and returns 202 on valid payload", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([]));
    mockEnqueueMove.mockReturnValue({ id: "move-1", status: "queued" });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", title: "Valid Title", body: "Valid description body long enough", priority: 2, assignee: "coder-backend" }));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.id).toMatch(/^task_/);
    expect(json.status).toBe("queued");
    expect(mockEnqueueMove).toHaveBeenCalledWith(expect.objectContaining({
      action: "create", board: "myboard", title: "Valid Title", body: "Valid description body long enough",
      assignee: "coder-backend", priority: 2, fromStatus: "triage", toStatus: "triage",
    }));
    expect(mockAudit).toHaveBeenCalledWith("ceo", "task.create", expect.stringContaining("myboard/task_"), "Valid Title", expect.any(String));
  });

  it("sanitizes control characters in title and body", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([]));
    mockEnqueueMove.mockReturnValue({ id: "m", status: "queued" });
    const { POST } = await import("./route");
    await POST(makeReq({ board: "myboard", title: "Clean\u0000Title", body: "Clean\u0007Description body is long enough", priority: 1 }));
    expect(mockEnqueueMove).toHaveBeenCalledWith(expect.objectContaining({
      title: "Clean Title",
      body: "Clean Description body is long enough",
    }));
  });
});

describe("PATCH /api/tasks — CEO drag move", () => {
  beforeEach(() => vi.clearAllMocks());
  const makeReq = (body: unknown, origin = "https://agents.paterski.com") =>
    new NextRequest("http://localhost/api/tasks", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });

  it("rejects mismatched origin with 403", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }, "https://evil.com"));
    expect(res.status).toBe(403);
  });

  it("rejects invalid board or task format with 400", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "BAD BOARD!", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(400);
  });

  it("rejects unknown targetStatus with 400", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "UNKNOWN_STATUS" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("status");
  });

  it("404 when board not found", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([]));
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "otherboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(404);
  });

  it("404 when task not found", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([createTestTask("OTHER", "todo")]));
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "MISSING", targetStatus: "scheduled" }));
    expect(res.status).toBe(404);
  });

  it("409 when status matches target", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([createTestTask("T-1", "scheduled")]));
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(409);
  });

  it("409 when move not allowed (blocked → needs decision)", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([createTestTask("T-1", "blocked")]));
    mockIsAllowedMove.mockReturnValue(false);
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "todo" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("decyzj");
  });

  it("409 when move not allowed (non-blocked) returns generic message", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([createTestTask("T-1", "done")]));
    mockIsAllowedMove.mockReturnValue(false);
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "todo" }));
    expect(res.status).toBe(409);
  });

  it("202 on valid transition (todo→scheduled)", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([createTestTask("T-1", "todo")]));
    mockIsAllowedMove.mockReturnValue(true);
    mockEnqueueMove.mockReturnValue({ id: "move-1", status: "queued" });
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(202);
    expect(mockEnqueueMove).toHaveBeenCalledWith({
      action: "move", board: "myboard", taskId: "T-1", fromStatus: "todo", toStatus: "scheduled",
      comment: expect.stringContaining("CEO drag"),
    });
  });

  it("409 on UNIQUE constraint (pending duplicate move)", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([createTestTask("T-1", "todo")]));
    mockIsAllowedMove.mockReturnValue(true);
    mockEnqueueMove.mockImplementation(() => { throw new Error("UNIQUE constraint failed: task_moves"); });
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("oczekujący ruch");
  });

  it("500 on generic enqueue error", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([createTestTask("T-1", "todo")]));
    mockIsAllowedMove.mockReturnValue(true);
    mockEnqueueMove.mockImplementation(() => { throw new Error("connection reset"); });
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(500);
  });
});
