import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DashboardSnapshot } from "@/lib/types";

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

const baseSnapshot = (tasks: { id: string; status: string }[] = []): DashboardSnapshot => ({
  generatedAt: 1, selectedBoard: "myboard",
  boards: [{ slug: "myboard", name: "My Board", description: "", icon: "◆", color: "#0", counts: { running: 0, blocked: 0 }, lastActivityAt: null }],
  agents: [], tasks: tasks as DashboardSnapshot["tasks"], activity: [],
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
    mockListMoves.mockImplementation(() => { throw new Error("db"); });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/tasks"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/tasks", () => {
  beforeEach(() => {
    vi.stubEnv("AOC_PUBLIC_URL", "https://agents.example.com");
    vi.clearAllMocks();
  });

  function makeReq(body: Record<string, unknown> = {}) {
    return new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("403 on origin mismatch", async () => {
    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST", headers: { origin: "https://evil.com", "content-type": "application/json" }, body: "{}",
    }));
    expect(res.status).toBe(403);
  });

  it("415 when content-type not JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST", headers: { origin: "https://agents.example.com" }, body: "x",
    }));
    expect(res.status).toBe(415);
  });

  it("413 when body over 12000 chars", async () => {
    const { POST } = await import("./route");
    const big = "x".repeat(12_001);
    const res = await POST(new NextRequest("http://localhost/api/tasks", {
      method: "POST", headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify({ board: "b", title: big, body: "x".repeat(100), priority: 2 }),
    }));
    expect(res.status).toBe(413);
  });

  it("400 on invalid board slug", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "Bad Board!", title: "t".repeat(50), body: "x".repeat(50), priority: 2 }));
    expect(res.status).toBe(400);
  });

  it("400 on title too short", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "b1", title: "ab", body: "x".repeat(50), priority: 2 }));
    expect(res.status).toBe(400);
  });

  it("400 on invalid priority", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "b1", title: "t".repeat(50), body: "x".repeat(50), priority: 99 }));
    expect(res.status).toBe(400);
  });

  it("404 when board not found", async () => {
    mockGetSnapshot.mockReturnValue({ generatedAt: 1, selectedBoard: "", boards: [], agents: [], tasks: [], activity: [] });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "nope", title: "t".repeat(50), body: "x".repeat(50), priority: 2 }));
    expect(res.status).toBe(404);
  });

  it("202 on valid create", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot());
    mockEnqueueMove.mockReturnValue({ id: "move-1", status: "queued" });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ board: "myboard", title: "Nowe zadanie", body: "Opis powinien miec co najmniej 10 znakow", priority: 2 }));
    expect(res.status).toBe(202);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mockEnqueueMove).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith("ceo", "task.create", expect.stringContaining("myboard/"), expect.any(String), expect.anything());
    const body = await res.json() as { id: string; status: string };
    expect(body.id).toMatch(/^task_[a-f0-9]{12}$/);
    expect(body.status).toBe("queued");
  });
});

describe("PATCH /api/tasks", () => {
  beforeEach(() => {
    vi.stubEnv("AOC_PUBLIC_URL", "https://agents.example.com");
    vi.clearAllMocks();
  });

  function makeReq(body: Record<string, unknown> = {}) {
    return new NextRequest("http://localhost/api/tasks", {
      method: "PATCH", headers: { origin: "https://agents.example.com", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("403 on origin mismatch", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(new NextRequest("http://localhost/api/tasks", {
      method: "PATCH", headers: { origin: "https://evil.com", "content-type": "application/json" }, body: "{}",
    }));
    expect(res.status).toBe(403);
  });

  it("400 on invalid taskId regex", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "b1", taskId: "bad id!", targetStatus: "scheduled" }));
    expect(res.status).toBe(400);
  });

  it("400 on unknown targetStatus", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "b1", taskId: "T-1", targetStatus: "nope" }));
    expect(res.status).toBe(400);
  });

  it("404 when board not found", async () => {
    mockGetSnapshot.mockReturnValue({ generatedAt: 1, selectedBoard: "", boards: [], agents: [], tasks: [], activity: [] });
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "nope", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(404);
  });

  it("404 when task not found", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([{ id: "OTHER", status: "todo" }] as never));
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "MISSING", targetStatus: "scheduled" }));
    expect(res.status).toBe(404);
  });

  it("409 when status matches target", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([{ id: "T-1", status: "scheduled" }] as never));
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(409);
  });

  it("409 when move not allowed (blocked → needs decision)", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([{ id: "T-1", status: "blocked" }] as never));
    mockIsAllowedMove.mockReturnValue(false);
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "todo" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("decyzj");
  });

  it("409 when move not allowed (non-blocked) returns generic message", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([{ id: "T-1", status: "done" }] as never));
    mockIsAllowedMove.mockReturnValue(false);
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "todo" }));
    expect(res.status).toBe(409);
  });

  it("202 on valid transition (todo→scheduled)", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([{ id: "T-1", status: "todo" }] as never));
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
    mockGetSnapshot.mockReturnValue(baseSnapshot([{ id: "T-1", status: "todo" }] as never));
    mockIsAllowedMove.mockReturnValue(true);
    mockEnqueueMove.mockImplementation(() => { throw new Error("UNIQUE constraint failed: task_moves"); });
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("oczekujący ruch");
  });

  it("500 on generic enqueue error", async () => {
    mockGetSnapshot.mockReturnValue(baseSnapshot([{ id: "T-1", status: "todo" }] as never));
    mockIsAllowedMove.mockReturnValue(true);
    mockEnqueueMove.mockImplementation(() => { throw new Error("connection reset"); });
    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq({ board: "myboard", taskId: "T-1", targetStatus: "scheduled" }));
    expect(res.status).toBe(500);
  });
});
