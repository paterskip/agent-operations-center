import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir = "";

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-broker-test-"));
  const boardDir = path.join(tmpDir, "boards", "my-app");
  fs.mkdirSync(boardDir, { recursive: true });
  fs.writeFileSync(path.join(boardDir, "board.json"), JSON.stringify({ slug: "my-app", name: "My App" }));

  const db = new Database(path.join(boardDir, "kanban.db"));
  db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT, updated_at INTEGER)");
  db.exec("CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER)");
  db.exec("INSERT INTO tasks VALUES ('task-1', 'todo', 1700000000)");
  db.close();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("HermesBrokerClient", () => {
  it("executes transition and inserts event", async () => {
    const { HermesBrokerClient } = await import("./broker-client");
    const client = new HermesBrokerClient({ kanbanRoot: tmpDir });

    const res = client.executeTransition("my-app", "task-1", "scheduled");
    expect(res.success).toBe(true);

    const db = new Database(path.join(tmpDir, "boards", "my-app", "kanban.db"));
    const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get("task-1") as { status: string };
    expect(task.status).toBe("scheduled");

    const events = db.prepare("SELECT * FROM task_events WHERE task_id = ?").all("task-1");
    expect(events.length).toBe(1);
    db.close();
  });
});
