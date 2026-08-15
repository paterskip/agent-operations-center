import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root = "";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-test-"));
  const kanbanRoot = path.join(root, "kanban");
  const boardRoot = path.join(kanbanRoot, "boards", "typer-bot");
  const profilesRoot = path.join(root, "profiles");
  fs.mkdirSync(boardRoot, { recursive: true });
  fs.mkdirSync(path.join(profilesRoot, "coder"), { recursive: true });
  fs.writeFileSync(path.join(kanbanRoot, "current"), "typer-bot\n");
  fs.writeFileSync(path.join(boardRoot, "board.json"), JSON.stringify({ slug: "typer-bot", name: "Typer Bot", icon: "⚽" }));
  fs.writeFileSync(path.join(profilesRoot, "coder", "profile.yaml"), "description: Test engineer profile.\ndescription_auto: false\n");

  const db = new Database(path.join(boardRoot, "kanban.db"));
  db.exec(`
    CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, branch_name TEXT, result TEXT, block_kind TEXT, last_heartbeat_at INTEGER, model_override TEXT);
    CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
    CREATE TABLE task_comments (id INTEGER, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
    CREATE TABLE task_runs (id INTEGER, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT);
    CREATE TABLE task_attachments (id INTEGER, task_id TEXT);
    CREATE TABLE task_events (id INTEGER, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
    INSERT INTO tasks VALUES ('t_test','Build dashboard','Safe body','coder','running',2,1700000000,1700000001,NULL,'feat/test',NULL,NULL,1700000002,NULL);
    INSERT INTO task_events VALUES (1,'t_test','claimed','{"worker_pid":123}',1700000001);
  `);
  db.close();
  process.env.HERMES_KANBAN_ROOT = kanbanRoot;
  process.env.HERMES_PROFILES_ROOT = profilesRoot;
  vi.resetModules();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("Hermes read-only adapter", () => {
  it("discovers boards from the configured root", async () => {
    const { discoverBoards } = await import("./hermes");
    expect(discoverBoards().map((board) => board.slug)).toEqual(["typer-bot"]);
  });

  it("returns a sanitized snapshot", async () => {
    const { getSnapshot } = await import("./hermes");
    const snapshot = getSnapshot("typer-bot");
    expect(snapshot.selectedBoard).toBe("typer-bot");
    expect(snapshot.agents.find((agent) => agent.slug === "coder" || agent.name === "Software Engineer")?.status).toBe("working");
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["workspace_path", "stored_path", "worker_pid", "claim_lock", "session_id", "kanban_notify_subs"]) expect(serialized).not.toContain(forbidden);
  });
});
