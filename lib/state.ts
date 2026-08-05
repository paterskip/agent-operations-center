import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const statePath = process.env.AOC_STATE_DB || "/data/state/aoc.db";

export type Idea = {
  id: string; title: string; description: string; project: string; priority: number;
  mode: "draft" | "analysis"; status: string; hermesTaskId: string | null;
  lastError: string | null; createdAt: number; updatedAt: number;
};

function openState() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const db = new Database(statePath);
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
  `);
  return db;
}

export function listIdeas(): Idea[] {
  const db = openState();
  try {
    return (db.prepare("SELECT id,title,description,project,priority,mode,status,hermes_task_id hermesTaskId,last_error lastError,created_at createdAt,updated_at updatedAt FROM ideas ORDER BY created_at DESC").all() as Idea[]);
  } finally { db.close(); }
}

export function createIdea(input: Omit<Idea, "id" | "status" | "hermesTaskId" | "lastError" | "createdAt" | "updatedAt">) {
  const db = openState();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = `idea_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const status = input.mode === "draft" ? "draft" : "queued";
    const transaction = db.transaction(() => {
      db.prepare("INSERT INTO ideas(id,title,description,project,priority,mode,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(id, input.title, input.description, input.project, input.priority, input.mode, status, now, now);
      if (input.mode === "analysis") db.prepare("INSERT INTO commands(kind,idea_id,status,created_at,updated_at) VALUES('create_analysis',?,'pending',?,?)").run(id, now, now);
    });
    transaction();
    return { id, status };
  } finally { db.close(); }
}

export function failedAttempts(ip: string) {
  const db = openState();
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 15 * 60;
    db.prepare("DELETE FROM auth_failures WHERE created_at < ?").run(cutoff);
    return Number((db.prepare("SELECT COUNT(*) count FROM auth_failures WHERE ip=?").get(ip) as { count: number }).count);
  } finally { db.close(); }
}

export function recordAuthFailure(ip: string) {
  const db = openState();
  try { db.prepare("INSERT INTO auth_failures(ip,created_at) VALUES(?,?)").run(ip, Math.floor(Date.now() / 1000)); }
  finally { db.close(); }
}

export function clearAuthFailures(ip: string) {
  const db = openState();
  try { db.prepare("DELETE FROM auth_failures WHERE ip=?").run(ip); }
  finally { db.close(); }
}

export function consumeRecoveryCode(hash: string) {
  const db = openState();
  try {
    if (db.prepare("SELECT 1 FROM used_recovery_codes WHERE code_hash=?").get(hash)) return false;
    db.prepare("INSERT INTO used_recovery_codes(code_hash,used_at) VALUES(?,?)").run(hash, Math.floor(Date.now() / 1000));
    return true;
  } finally { db.close(); }
}

export function audit(actor: string, action: string, target: string | null, detail: string | null, ip: string | null) {
  const db = openState();
  try { db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES(?,?,?,?,?,?)").run(actor, action, target, detail, ip, Math.floor(Date.now() / 1000)); }
  finally { db.close(); }
}
