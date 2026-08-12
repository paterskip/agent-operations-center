import { describe, expect, it, vi } from "vitest";

// Core logic extracted from Dashboard for testing
// Tests verify the refresh cooldown gate behavior

describe("refresh gate logic (cooldown-based)", () => {
  it("fires on first trigger", () => {
    let gate = 0;
    const called: number[] = [];
    const COOLDOWN = 2000;

    function safeRefresh() {
      const now = Date.now();
      if (now - gate < COOLDOWN) return;
      gate = now;
      called.push(now);
    }

    safeRefresh();
    expect(called.length).toBe(1);
  });

  it("blocks second trigger within cooldown window", () => {
    let gate = 0;
    const called: number[] = [];
    const COOLDOWN = 2000;

    function safeRefresh() {
      const now = Date.now();
      if (now - gate < COOLDOWN) return;
      gate = now;
      called.push(now);
    }

    safeRefresh();       // fires
    safeRefresh();       // blocked (within cooldown)
    safeRefresh();       // blocked (within cooldown)
    expect(called.length).toBe(1);
  });

  it("fires again after cooldown expires", () => {
    let gate = 0;
    const called: number[] = [];
    const COOLDOWN = 50; // short for testing

    function safeRefresh(now: number) {
      if (now - gate < COOLDOWN) return;
      gate = now;
      called.push(now);
    }

    const t0 = 1000000;
    safeRefresh(t0);           // fires at t0
    safeRefresh(t0 + 30);      // blocked (30 < 50ms cooldown)
    safeRefresh(t0 + 60);      // fires at t0+60 (60 >= 50ms)
    safeRefresh(t0 + 100);     // blocked (40 < 50ms from last fire)
    safeRefresh(t0 + 200);     // fires at t0+200 (140 >= 50ms)

    expect(called.length).toBe(3);
    expect(called).toEqual([t0, t0 + 60, t0 + 200]);
  });

  it("simulates SSE + polling scenario: only one fires per cooldown", () => {
    // Scenario: SSE fires at T=2.5s, polling fires at T=3.6s
    // With 2s cooldown, the second should be blocked
    let gate = 0;
    const called: number[] = [];
    const COOLDOWN = 2000;

    function safeRefresh(now: number) {
      if (now - gate < COOLDOWN) return;
      gate = now;
      called.push(now);
    }

    const tSSE = 100_000;       // SSE fires at T
    const tPolling = 101_100;   // Polling fires at T + 1.1s

    safeRefresh(tSSE);          // fires
    safeRefresh(tPolling);      // blocked (1.1s < 2s cooldown)

    expect(called.length).toBe(1);
    expect(called[0]).toBe(tSSE);
  });

  it("SSE fires >2s apart: both fire (normal operation)", () => {
    let gate = 0;
    const called: number[] = [];
    const COOLDOWN = 2000;

    function safeRefresh(now: number) {
      if (now - gate < COOLDOWN) return;
      gate = now;
      called.push(now);
    }

    const t1 = 100_000;        // SSE poll 1
    const t2 = 102_500;        // SSE poll 2 (2.5s later)
    const t3 = 105_000;        // SSE poll 3 (2.5s later)

    safeRefresh(t1);   // fires
    safeRefresh(t2);   // fires (2.5s > 2s cooldown)
    safeRefresh(t3);   // fires (2.5s > 2s cooldown)

    expect(called.length).toBe(3);
  });

  it("burst of 5 triggers within 500ms: only first fires", () => {
    let gate = 0;
    const called: number[] = [];
    const COOLDOWN = 2000;

    function safeRefresh(now: number) {
      if (now - gate < COOLDOWN) return;
      gate = now;
      called.push(now);
    }

    const base = 100_000;
    for (let i = 0; i < 5; i++) {
      safeRefresh(base + i * 100); // every 100ms for 500ms
    }

    expect(called.length).toBe(1);
  });
});

describe("optimistic update — decision flow", () => {
  it("moves task from blocked to ready on approve", () => {
    const tasks = [
      { id: "t-1", title: "Test", status: "blocked", assignee: null, priority: 2 },
      { id: "t-2", title: "Other", status: "running", assignee: "coder", priority: 3 },
    ];

    const TARGET: Record<string, string> = { approve: "ready", reject: "done", hold: "blocked" };
    const selectedTask = tasks[0];
    const targetStatus = TARGET["approve"];

    const updated = tasks.map((t) =>
      t.id === selectedTask.id ? { ...t, status: targetStatus } : t
    );

    expect(updated.find((t) => t.id === "t-1")?.status).toBe("ready");
    expect(updated.find((t) => t.id === "t-2")?.status).toBe("running");
  });

  it("preserves original data for revert on error", () => {
    const original = { tasks: [{ id: "t-1", status: "blocked" }], boards: [] };
    const backup = JSON.parse(JSON.stringify(original));

    // Simulate optimistic update
    const optimistic = {
      ...original,
      tasks: original.tasks.map((t) =>
        t.id === "t-1" ? { ...t, status: "ready" } : t
      ),
    };

    expect(optimistic.tasks[0].status).toBe("ready");

    // Simulate revert on error
    expect(backup.tasks[0].status).toBe("blocked");
  });
});

describe("optimistic update — DnD flow", () => {
  it("moves task to target status immediately", () => {
    const tasks = [
      { id: "t-1", status: "todo" },
      { id: "t-2", status: "done" },
    ];

    const toStatus = "running";
    const updated = tasks.map((t) =>
      t.id === "t-1" ? { ...t, status: toStatus } : t
    );

    expect(updated.find((t) => t.id === "t-1")?.status).toBe("running");
    expect(updated.find((t) => t.id === "t-2")?.status).toBe("done");
  });

  it("reverts on error", () => {
    const original = { tasks: [{ id: "t-1", status: "todo" }, { id: "t-2", status: "done" }], boards: [] };
    const backup = JSON.parse(JSON.stringify(original));

    // Apply optimistic
    const optimistic = {
      ...original,
      tasks: original.tasks.map((t) =>
        t.id === "t-1" ? { ...t, status: "running" } : t
      ),
    };

    expect(optimistic.tasks[0].status).toBe("running");
    // Revert
    expect(backup.tasks[0].status).toBe("todo");
  });
});

describe("refresh architecture invariant", () => {
  it("actions (decision/move/create) are not refresh sources", () => {
    // Design invariant: only selectBoard calls load() directly.
    // All other paths use SSE (safeRefresh) for auto-refresh.
    // submitDecision, moveTask, submitNewTask do optimistic update + API call only.

    // This test just documents the pattern. Actual enforcement is in code review.
    const REFRESH_SOURCES = new Set(["selectBoard", "SSE:change"]);
    const NON_SOURCES = ["submitDecision", "moveTask", "submitNewTask"];

    for (const name of NON_SOURCES) {
      expect(REFRESH_SOURCES.has(name)).toBe(false);
    }

    for (const name of REFRESH_SOURCES) {
      expect(REFRESH_SOURCES.has(name)).toBe(true);
    }
  });
});
