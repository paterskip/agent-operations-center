import { describe, expect, it } from "vitest";
import { applyTaskDeltas, mergeActivity, type ActivityEntry } from "./kanban-delta";

const base = [
  { id: "t1", status: "todo", assignee: "coder", board: "default" },
  { id: "t2", status: "running", assignee: "pm", board: "default" },
  { id: "t3", status: "done", assignee: "reviewer", board: "default" },
];

describe("applyTaskDeltas", () => {
  it("returns the same reference when nothing changed", () => {
    const deltas = [
      { id: "t1", status: "todo", assignee: "coder", board: "default", lastHeartbeatAt: 100 },
      { id: "t2", status: "running", assignee: "pm", board: "default", lastHeartbeatAt: 200 },
    ];
    expect(applyTaskDeltas(base, deltas)).toBe(base);
  });

  it("ignores lastHeartbeatAt-only changes (no churn)", () => {
    const deltas = [{ id: "t2", status: "running", assignee: "pm", board: "default", lastHeartbeatAt: 999 }];
    expect(applyTaskDeltas(base, deltas)).toBe(base);
  });

  it("updates a card in place when status changes", () => {
    const deltas = [{ id: "t1", status: "ready", assignee: "coder", board: "default", lastHeartbeatAt: 1 }];
    const next = applyTaskDeltas(base, deltas);
    expect(next).not.toBe(base);
    expect(next[0]).toMatchObject({ id: "t1", status: "ready" });
    expect(next[1]).toBe(base[1]); // untouched card keeps its reference
  });

  it("updates assignee changes", () => {
    const deltas = [{ id: "t3", status: "done", assignee: "pm", board: "default", lastHeartbeatAt: 1 }];
    const next = applyTaskDeltas(base, deltas);
    expect(next[2]).toMatchObject({ assignee: "pm" });
  });

  it("handles empty deltas without allocation", () => {
    expect(applyTaskDeltas(base, [])).toBe(base);
  });
});

describe("mergeActivity", () => {
  const e = (id: number): ActivityEntry => ({ id, board: "default", kind: "completed", taskId: `t${id}`, taskTitle: "x", assignee: null, createdAt: id });

  it("prepends new entries and dedupes", () => {
    const prev = [e(3), e(2)];
    const next = mergeActivity(prev, [e(5), e(2)]);
    expect(next.map((x) => x.id)).toEqual([5, 3, 2]);
  });

  it("returns the same reference when nothing new", () => {
    const prev = [e(3)];
    expect(mergeActivity(prev, [e(3)])).toBe(prev);
  });

  it("caps the feed length", () => {
    const prev = Array.from({ length: 60 }, (_, i) => e(60 - i));
    const next = mergeActivity(prev, [e(61)], 60);
    expect(next.length).toBe(60);
    expect(next[0].id).toBe(61);
  });
});
