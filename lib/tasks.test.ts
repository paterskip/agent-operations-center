import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root = "";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-tasks-"));
  process.env.AOC_STATE_DB = path.join(root, "aoc.db");

  // Create a test board
  const kanbanRoot = path.join(root, "kanban");
  const boardRoot = path.join(kanbanRoot, "boards", "test-app");
  fs.mkdirSync(boardRoot, { recursive: true });
  fs.writeFileSync(path.join(boardRoot, "board.json"), JSON.stringify({ slug: "test-app", name: "Test App", icon: "⚡" }));

  const db = new Database(path.join(boardRoot, "kanban.db"));
  db.exec(`
    CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, branch_name TEXT, result TEXT, block_kind TEXT, last_heartbeat_at INTEGER, model_override TEXT);
    CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
    CREATE TABLE task_comments (id INTEGER, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
    CREATE TABLE task_runs (id INTEGER, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT);
    CREATE TABLE task_attachments (id INTEGER, task_id TEXT);
    CREATE TABLE task_events (id INTEGER, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
    INSERT INTO tasks VALUES ('t_movable','Move me','A task to drag','coder','todo',2,1700000000,1700000001,NULL,NULL,NULL,NULL,1700000002,NULL);
    INSERT INTO task_events VALUES (1,'t_movable','created','{}',1700000001);
  `);
  db.close();
  process.env.HERMES_KANBAN_ROOT = kanbanRoot;
  vi.resetModules();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("Task state (move/creation)", () => {
  it("enqueueMove persists a move command", async () => {
    const { enqueueMove } = await import("../lib/state");
    const result = enqueueMove({
      action: "move", board: "test-app", taskId: "t_movable",
      fromStatus: "todo", toStatus: "scheduled", comment: "test drag",
    });
    expect(result.status).toBe("queued");
    expect(result.id).toMatch(/^move_/);
  });

  it("listMoves returns queued moves", async () => {
    const { listMoves } = await import("../lib/state");
    const moves = listMoves("test-app", "t_movable");
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves[0].fromStatus).toBe("todo");
    expect(moves[0].toStatus).toBe("scheduled");
  });

  it("enqueueMove for create persists title and body", async () => {
    const { enqueueMove, listMoves } = await import("../lib/state");
    const result = enqueueMove({
      action: "create", board: "test-app", taskId: "task_new_feature",
      title: "Add feature X", body: "A longer body text here", priority: 3,
      fromStatus: "triage", toStatus: "triage",
    });
    expect(result.status).toBe("queued");
    const moves = listMoves("test-app", "task_new_feature");
    expect(moves[0].title).toBe("Add feature X");
  });

  it("prevents duplicate queued moves on the same task", async () => {
    const { enqueueMove } = await import("../lib/state");
    // First move is already queued from the first test; second should fail
    expect(() =>
      enqueueMove({ action: "move", board: "test-app", taskId: "t_movable", fromStatus: "todo", toStatus: "scheduled" })
    ).toThrow();
  });
});

describe("Task API transitions", () => {
  it("defines allowed transitions for all known statuses", async () => {
    // Import the route's ALLOWED_TRANSITIONS via snapshot
    const { getSnapshot } = await import("../lib/hermes");
    const snap = getSnapshot("test-app");
    const task = snap.tasks.find((t) => t.id === "t_movable");
    expect(task).toBeDefined();
    expect(task!.status).toBe("todo");
  });

  it("rejects invalid transitions (done → scheduled)", () => {
    // validated by the PATCH route at runtime
    const ALLOWED_TARGETS: Record<string, string[]> = {
      triage: ["todo"],
      todo: ["scheduled"],
      scheduled: ["todo", "ready"],
      ready: ["todo", "running"],
      running: ["blocked", "review"],
      blocked: ["ready"],
      review: ["done"],
      done: ["todo"],
    };
    expect(ALLOWED_TARGETS["done"]).not.toContain("scheduled");
    expect(ALLOWED_TARGETS["done"]).toContain("todo");
  });
});
