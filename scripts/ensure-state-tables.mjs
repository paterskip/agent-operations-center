import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, project TEXT NOT NULL,
    priority INTEGER NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
    hermes_task_id TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, idea_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY(idea_id) REFERENCES ideas(id)
  );
  CREATE TABLE IF NOT EXISTS auth_failures (ip TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS used_recovery_codes (code_hash TEXT PRIMARY KEY, used_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
    target TEXT, detail TEXT, ip TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_decisions (
    id TEXT PRIMARY KEY, board TEXT NOT NULL, task_id TEXT NOT NULL, action TEXT NOT NULL,
    from_status TEXT NOT NULL, to_status TEXT, comment TEXT NOT NULL, status TEXT NOT NULL,
    result_status TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_decisions_pending
    ON task_decisions(board, task_id) WHERE status IN ('queued','running');
  CREATE TABLE IF NOT EXISTS task_moves (
    id TEXT PRIMARY KEY, board TEXT NOT NULL, task_id TEXT NOT NULL, action TEXT NOT NULL,
    from_status TEXT, to_status TEXT, title TEXT, body TEXT,
    assignee TEXT, priority INTEGER, comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, result_status TEXT, last_error TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_moves_pending
    ON task_moves(board, task_id) WHERE status IN ('queued','running');
`);

db.close();
console.log("State DB tables created successfully.");
