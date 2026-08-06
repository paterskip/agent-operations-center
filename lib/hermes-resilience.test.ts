import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root = "";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-resilience-"));
  const kanbanRoot = path.join(root, "kanban");
  const profilesRoot = path.join(root, "profiles");
  fs.mkdirSync(path.join(profilesRoot, "coder"), { recursive: true });
  fs.writeFileSync(path.join(profilesRoot, "coder", "profile.yaml"), "description: Test\n");

  // Board 1 (simulates "default" with separate WAL/SHM mounts)
  const board1Dir = path.join(kanbanRoot, "boards", "app-one");
  fs.mkdirSync(board1Dir, { recursive: true });
  fs.writeFileSync(path.join(board1Dir, "board.json"), JSON.stringify({ slug: "app-one", name: "App One", icon: "1️⃣" }));
  const db1 = new Database(path.join(board1Dir, "kanban.db"));
  db1.pragma("journal_mode = WAL");
  db1.exec("CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, branch_name TEXT, result TEXT, block_kind TEXT, last_heartbeat_at INTEGER, model_override TEXT)");
  db1.exec("CREATE TABLE task_links (parent_id TEXT, child_id TEXT)");
  db1.exec("CREATE TABLE task_comments (id INTEGER, task_id TEXT, author TEXT, body TEXT, created_at INTEGER)");
  db1.exec("CREATE TABLE task_runs (id INTEGER, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT)");
  db1.exec("CREATE TABLE task_attachments (id INTEGER, task_id TEXT)");
  db1.exec("CREATE TABLE task_events (id INTEGER, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER)");
  db1.exec("INSERT INTO tasks VALUES ('t1','Task 1','Body','coder','running',2,1700000000,1700000001,NULL,NULL,NULL,NULL,1700000002,NULL)");
  db1.exec("INSERT INTO task_events VALUES (1,'t1','created','{}',1700000001)");
  db1.close();

  // Board 2
  const board2Dir = path.join(kanbanRoot, "boards", "app-two");
  fs.mkdirSync(board2Dir, { recursive: true });
  fs.writeFileSync(path.join(board2Dir, "board.json"), JSON.stringify({ slug: "app-two", name: "App Two", icon: "2️⃣" }));
  const db2 = new Database(path.join(board2Dir, "kanban.db"));
  db2.pragma("journal_mode = WAL");
  db2.exec("CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, branch_name TEXT, result TEXT, block_kind TEXT, last_heartbeat_at INTEGER, model_override TEXT)");
  db2.exec("CREATE TABLE task_links (parent_id TEXT, child_id TEXT)");
  db2.exec("CREATE TABLE task_comments (id INTEGER, task_id TEXT, author TEXT, body TEXT, created_at INTEGER)");
  db2.exec("CREATE TABLE task_runs (id INTEGER, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT)");
  db2.exec("CREATE TABLE task_attachments (id INTEGER, task_id TEXT)");
  db2.exec("CREATE TABLE task_events (id INTEGER, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER)");
  db2.exec("INSERT INTO tasks VALUES ('t2','Task 2','Body','pm','todo',3,1700000000,NULL,NULL,NULL,NULL,NULL,NULL,NULL)");
  db2.exec("INSERT INTO task_events VALUES (2,'t2','created','{}',1700000001)");
  db2.close();

  // Default board (legacy path)
  const defaultDb = path.join(kanbanRoot, "..", "kanban.db");
  const dDefault = new Database(defaultDb);
  dDefault.pragma("journal_mode = WAL");
  dDefault.exec("CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, branch_name TEXT, result TEXT, block_kind TEXT, last_heartbeat_at INTEGER, model_override TEXT)");
  dDefault.exec("CREATE TABLE task_links (parent_id TEXT, child_id TEXT)");
  dDefault.exec("CREATE TABLE task_comments (id INTEGER, task_id TEXT, author TEXT, body TEXT, created_at INTEGER)");
  dDefault.exec("CREATE TABLE task_runs (id INTEGER, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT)");
  dDefault.exec("CREATE TABLE task_attachments (id INTEGER, task_id TEXT)");
  dDefault.exec("CREATE TABLE task_events (id INTEGER, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER)");
  dDefault.close();

  process.env.HERMES_KANBAN_ROOT = kanbanRoot;
  process.env.HERMES_PROFILES_ROOT = profilesRoot;
  process.env.AOC_AGENTS = "coder,pm";
  vi.resetModules();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("getSnapshot resilience", () => {
  it("survives sequential multi-board opens including default first", async () => {
    const { getSnapshot } = await import("../lib/hermes");

    // Run getSnapshot multiple times to stress-test sequential DB opens
    for (let i = 0; i < 5; i++) {
      const snap = getSnapshot();
      expect(snap.boards.length).toBeGreaterThanOrEqual(2);
      expect(snap.boards.map((b) => b.slug).sort()).toEqual(["app-one", "app-two", "default"].sort());
    }
  });

  it("returns valid data for a specific board after default board was opened", async () => {
    const { getSnapshot } = await import("../lib/hermes");
    // First open default (to trigger the sequential issue)
    getSnapshot("default");
    // Then open a specific board
    const snap = getSnapshot("app-two");
    expect(snap.selectedBoard).toBe("app-two");
    expect(snap.tasks.length).toBe(1);
    expect(snap.tasks[0].id).toBe("t2");
  });

  it("activityCursor survives sequential board opens", async () => {
    const { activityCursor } = await import("../lib/hermes");
    const cursor = activityCursor();
    expect(cursor).toContain("app-one:");
    expect(cursor).toContain("app-two:");
    expect(cursor).toContain("default:");
  });
});
