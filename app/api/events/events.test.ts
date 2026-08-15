import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AgentLiveStatus, TaskLiveDelta } from "@/lib/hermes";
import type { ActivityEntry } from "@/lib/kanban-delta";

// Mock the hermes data source so we control cursor/activity/agents/deltas
const mockCursor = vi.hoisted(() => ({ value: "board1:0", throwOnTick: false }));
const mockAgents = vi.hoisted(() => ({ value: [] as AgentLiveStatus[] }));
const mockDeltas = vi.hoisted(() => ({ value: [] as TaskLiveDelta[] }));
const mockEntries = vi.hoisted(() => ({ value: [] as ActivityEntry[] }));
const mockClassify = vi.hoisted(() => ({ value: "none" }));

vi.mock("@/lib/hermes", () => ({
  activityCursor: () => { if (mockCursor.throwOnTick) throw new Error("DB down"); return mockCursor.value; },
  activityDelta: () => mockEntries.value,
  getAgentStatuses: () => mockAgents.value,
  getTaskDeltas: () => mockDeltas.value,
}));

vi.mock("@/lib/kanban-delta", () => ({
  classifyEvents: () => mockClassify.value,
  applyTaskDeltas: (t: unknown) => t,
  mergeActivity: (a: unknown) => a,
}));

const { GET } = await import("./route");

describe("GET /api/events — SSE framing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCursor.value = "board1:0";
    mockCursor.throwOnTick = false;
    mockAgents.value = [];
    mockDeltas.value = [];
    mockEntries.value = [];
    mockClassify.value = "none";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a ready event on connect with the current cursor", async () => {
    mockCursor.value = "board1:42";
    const req = new Request("http://localhost/api/events");
    const res = GET(req);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("Connection")).toBe("keep-alive");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain("event: ready");
    expect(text).toContain('"cursor":"board1:42"');
    reader.releaseLock();
  });

  it("sends heartbeat-only tick when cursor unchanged", async () => {
    const req = new Request("http://localhost/api/events");
    const res = GET(req);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // Read the initial 'ready' frame
    let first = "";
    do {
      const { value, done } = await reader.read();
      if (done) break;
      first += decoder.decode(value, { stream: true });
    } while (!first.includes("event: ready"));

    // Advance past the 2500ms interval — cursor unchanged → heartbeat comment
    await vi.advanceTimersByTimeAsync(2500);
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = decoder.decode(value, { stream: true });
    expect(text).toContain(": heartbeat");

    reader.releaseLock();
  });

  it("sends presence event when cursor changed but no work", async () => {
    const req = new Request("http://localhost/api/events");
    const res = GET(req);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Drain ready frame
    let drained = "";
    while (!drained.includes("event: ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      drained += decoder.decode(value, { stream: true });
    }

    // Change cursor + classify as presence
    mockCursor.value = "board1:99";
    mockEntries.value = [{ id: 1, kind: "heartbeat", board: "board1", taskId: "e1", taskTitle: "t", assignee: null, createdAt: 0 }];
    mockClassify.value = "presence";
    mockAgents.value = [{ slug: "pm", name: "PM", status: "idle", currentTask: null, currentBoard: null, lastHeartbeatAt: null }];

    await vi.advanceTimersByTimeAsync(2500);
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = decoder.decode(value, { stream: true });
    expect(text).toContain("event: presence");
    expect(text).toContain('"cursor":"board1:99"');
    expect(text).toContain("agents");

    reader.releaseLock();
  });

  it("sends change event (tasks+activity) when work events present", async () => {
    const req = new Request("http://localhost/api/events");
    const res = GET(req);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let drained = "";
    while (!drained.includes("event: ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      drained += decoder.decode(value, { stream: true });
    }

    mockCursor.value = "board1:100";
    mockEntries.value = [{ id: 2, kind: "completed", board: "board1", taskId: "e2", taskTitle: "Zadanie X", assignee: "pm", createdAt: 0 }];
    mockClassify.value = "work";
    mockDeltas.value = [{ id: "TASK-1", status: "done", assignee: "pm", board: "board1", lastHeartbeatAt: null }];

    await vi.advanceTimersByTimeAsync(2500);
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = decoder.decode(value, { stream: true });
    expect(text).toContain("event: change");
    expect(text).toContain('"tasks"');
    expect(text).toContain('"activity"');
    expect(text).toContain('"TASK-1"');

    reader.releaseLock();
  });

  it("emits source-error when hermes functions throw", async () => {
    const req = new Request("http://localhost/api/events");
    const res = GET(req);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let drained = "";
    while (!drained.includes("event: ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      drained += decoder.decode(value, { stream: true });
    }

    // Make the mocked hermes throw on the tick
    mockCursor.throwOnTick = true;

    await vi.advanceTimersByTimeAsync(2500);
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = decoder.decode(value, { stream: true });
    expect(text).toContain("event: source-error");
    expect(text).toContain("Hermes data source unavailable");

    reader.releaseLock();
  });

  it("closes stream and stops timer when request is aborted", async () => {
    const controller = new AbortController();
    const req = new Request("http://localhost/api/events", { signal: controller.signal });
    const res = GET(req);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Drain ready
    let drained = "";
    while (!drained.includes("event: ready")) {
      const { value, done } = await reader.read();
      if (done) break;
      drained += decoder.decode(value, { stream: true });
    }

    controller.abort();

    // Stream should close after abort — reader.read() returns {done:true} or closed rejects
    const result = await reader.read().catch((e) => ({ done: true, value: null, err: e }));
    expect(result.done ?? true).toBe(true);
    reader.releaseLock();
  });
});
