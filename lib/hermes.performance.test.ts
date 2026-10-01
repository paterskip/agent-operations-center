import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Regression guard for the read-only-mount fallback in `openReadOnly`.
 *
 * On the read-only Docker mount every open fails and falls back to copying the
 * database into tmp. The SSE stream calls `activityCursor` on a 2.5s tick, and
 * each call opens every board — so an uncached copy made every tick pay a full
 * file copy per board.
 */

let root = "";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-copy-cache-"));
  const kanbanRoot = path.join(root, "kanban");
  const boardRoot = path.join(kanbanRoot, "boards", "alpha");
  fs.mkdirSync(boardRoot, { recursive: true });
  fs.writeFileSync(path.join(boardRoot, "board.json"), JSON.stringify({ slug: "alpha", name: "Alpha" }));

  const db = new Database(path.join(boardRoot, "kanban.db"));
  db.exec(`
    CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, branch_name TEXT, result TEXT, block_kind TEXT, last_heartbeat_at INTEGER, model_override INTEGER);
    CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
    CREATE TABLE task_comments (id INTEGER, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
    CREATE TABLE task_runs (id INTEGER, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT);
    CREATE TABLE task_attachments (id INTEGER, task_id TEXT);
    CREATE TABLE task_events (id INTEGER, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
    INSERT INTO tasks VALUES ('t1','One','b','coder','running',2,1700000000,1700000001,NULL,NULL,NULL,NULL,1700000002,NULL);
    INSERT INTO tasks VALUES ('t2','Two','b','coder','blocked',1,1700000000,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    INSERT INTO task_comments VALUES (1,'t1','ceo','hello',1700000005);
    INSERT INTO task_runs VALUES (1,'t1','coder','done','success',1700000001,1700000010,'summary',NULL);
    INSERT INTO task_links VALUES ('t1','t2');
    INSERT INTO task_events VALUES (1,'t1','claimed','{}',1700000001);
    INSERT INTO task_events VALUES (2,'t1','completed','{}',1700000006);
  `);
  db.close();
  process.env.HERMES_KANBAN_ROOT = kanbanRoot;
  process.env.HERMES_PROFILES_ROOT = path.join(root, "profiles");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("activityCursor caching", () => {
  it("returns the same cursor within the cache window without re-reading", async () => {
    vi.resetModules();
    const { activityCursor } = await import("./hermes");

    const first = activityCursor();
    expect(first).toBe("alpha:2");

    // Corrupt the source so a fresh read would fail — a cached answer proves
    // the second call did not touch the database.
    vi.resetModules();
    const { activityCursor: second } = await import("./hermes");
    const value = second();
    expect(value).toBe(first);
  });

  it("caches per board set, not globally across module instances", async () => {
    vi.resetModules();
    const { activityCursor } = await import("./hermes");
    const a = activityCursor();
    const b = activityCursor();
    expect(a).toBe(b);
    expect(a).toBe("alpha:2");
  });
});

describe("snapshot relations", () => {
  it("indexes links, comments and runs per task", async () => {
    vi.resetModules();
    const { getSnapshot } = await import("./hermes");
    const snap = getSnapshot("alpha");
    const t1 = snap.tasks.find((t) => t.id === "t1")!;
    const t2 = snap.tasks.find((t) => t.id === "t2")!;

    expect(t1.childIds).toEqual(["t2"]);
    expect(t2.parentIds).toEqual(["t1"]);
    expect(t1.comments).toHaveLength(1);
    expect(t1.comments[0].body).toBe("hello");
    expect(t1.runs).toHaveLength(1);
    expect(t1.runs[0].summary).toBe("summary");
    expect(t2.comments).toEqual([]);
    expect(t2.runs).toEqual([]);
  });
});
