import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const statePath = process.env.AOC_STATE_DB || "/data/state/aoc.db";

let isBrokerRunning = false;
let hasPendingTrigger = false;

/**
 * Pobudza brokera Hermesa natychmiast po zapisaniu zadania/pomysłu/decyzji (model Event-Driven).
 * Działa asynchronicznie w tle i nie blokuje odpowiedzi HTTP do przeglądarki.
 * Wyposażony w flagę hasPendingTrigger, która gwarantuje wywołanie kolejnego cyklu,
 * jeśli nowe zdarzenie nadejdzie w trakcie trwania bieżącego przetwarzania.
 */
export function triggerBroker() {
  if (process.env.NODE_ENV === "test") return;

  const hermesBin = process.env.HERMES_BIN || "/usr/local/bin/hermes";
  if (!fs.existsSync(/*turbopackIgnore: true*/ hermesBin)) {
    // In container environment without hermes binary: command remains safely queued in SQLite for host broker daemon
    return;
  }

  if (isBrokerRunning) {
    hasPendingTrigger = true;
    return;
  }

  isBrokerRunning = true;
  hasPendingTrigger = false;

  const scriptPath = path.join(process.cwd(), "scripts", "process-commands.mjs");
  try {
    execFile(
      process.execPath,
      [scriptPath],
      {
        timeout: 45_000,
        env: {
          ...process.env,
          PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME || "/root",
        },
      },
      () => {
        isBrokerRunning = false;
        if (hasPendingTrigger) {
          hasPendingTrigger = false;
          triggerBroker();
        }
      }
    );
  } catch {
    isBrokerRunning = false;
    if (hasPendingTrigger) {
      hasPendingTrigger = false;
      triggerBroker();
    }
  }
}

export type Idea = {
  id: string; title: string; description: string; project: string; priority: number;
  mode: "draft" | "analysis"; status: string; hermesTaskId: string | null;
  lastError: string | null; createdAt: number; updatedAt: number;
};

export type DecisionAction = "approve" | "reject" | "resume" | "hold";

export type DecisionRecord = {
  id: string; board: string; taskId: string; action: DecisionAction; fromStatus: string;
  toStatus: string | null; comment: string; status: string; resultStatus: string | null;
  lastError: string | null; createdAt: number; updatedAt: number;
};

let stateInitialized = false;

function openState() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const db = new Database(statePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // One-time setup: create tables on first access. The broker owns schema
  // lifecycle (through ensure-state-tables.mjs), but this codepath handles
  // local dev and test environments that don't run the broker.
  if (!stateInitialized) {
    stateInitialized = true;
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
  }
  return db;
}

export function enqueueDecision(input: { board: string; taskId: string; action: DecisionAction; fromStatus: string; toStatus: string | null; comment: string }) {
  const db = openState();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = `decision_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    db.prepare("INSERT INTO task_decisions(id,board,task_id,action,from_status,to_status,comment,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'queued',?,?)")
      .run(id, input.board, input.taskId, input.action, input.fromStatus, input.toStatus, input.comment, now, now);
    triggerBroker();
    return { id, status: "queued" };
  } finally { db.close(); }
}

export function listDecisions(board?: string, taskId?: string): DecisionRecord[] {
  const db = openState();
  try {
    // Filtrujemy po każdym podanym kryterium z osobna. Wcześniej podanie samego
    // taskId (bez board) cicho zwracało WSZYSTKIE decyzje z wszystkich kart.
    const clauses: string[] = [];
    const params: string[] = [];
    if (board) { clauses.push("board=?"); params.push(board); }
    if (taskId) { clauses.push("task_id=?"); params.push(taskId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.prepare(`SELECT id,board,task_id taskId,action,from_status fromStatus,to_status toStatus,comment,status,result_status resultStatus,last_error lastError,created_at createdAt,updated_at updatedAt FROM task_decisions ${where} ORDER BY created_at DESC LIMIT 200`).all(...params) as DecisionRecord[];
  } finally { db.close(); }
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
    if (input.mode === "analysis") {
      triggerBroker();
    }
    return { id, status };
  } finally { db.close(); }
}

export function audit(actor: string, action: string, target: string | null, detail: string | null, ip: string | null) {
  const db = openState();
  try { db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES(?,?,?,?,?,?)").run(actor, action, target, detail, ip, Math.floor(Date.now() / 1000)); }
  finally { db.close(); }
}

export type AuditLogEntry = {
  id: number; actor: string; action: string; target: string | null;
  detail: string | null; ip: string | null; createdAt: number;
};

export function getAuditLog(limit = 100, sinceSec = 0): AuditLogEntry[] {
  const db = openState();
  try {
    return db.prepare(
      "SELECT id,actor,action,target,detail,ip,created_at createdAt FROM audit_log WHERE created_at >= ? ORDER BY id DESC LIMIT ?"
    ).all(sinceSec, limit) as AuditLogEntry[];
  } finally { db.close(); }
}

export type TaskMoveAction = "create" | "move" | "comment";

export type MoveRecord = {
  id: string; board: string; taskId: string; action: TaskMoveAction;
  fromStatus: string | null; toStatus: string | null; title: string | null;
  body: string | null; assignee: string | null; priority: number | null;
  comment: string; status: string; resultStatus: string | null;
  lastError: string | null; createdAt: number; updatedAt: number;
};

export function enqueueMove(input: {
  action: TaskMoveAction; board: string; taskId: string;
  title?: string; body?: string; assignee?: string; priority?: number;
  fromStatus?: string; toStatus?: string; comment?: string;
}) {
  const db = openState();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = `move_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    db.prepare(`INSERT INTO task_moves(id,board,task_id,action,from_status,to_status,title,body,assignee,priority,comment,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)`)
      .run(id, input.board, input.taskId, input.action, input.fromStatus || null, input.toStatus || null,
        input.title || null, input.body || null, input.assignee || null, input.priority ?? null,
        input.comment || "", now, now);
    triggerBroker();
    return { id, status: "queued" };
  } finally { db.close(); }
}

export function listMoves(board?: string, taskId?: string): MoveRecord[] {
  const db = openState();
  try {
    // jw. — każde kryterium zawęża wynik niezależnie od drugiego
    const clauses: string[] = [];
    const params: string[] = [];
    if (board) { clauses.push("board=?"); params.push(board); }
    if (taskId) { clauses.push("task_id=?"); params.push(taskId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.prepare(`SELECT id,board,task_id taskId,action,from_status fromStatus,to_status toStatus,
      title,body,assignee,priority,comment,status,result_status resultStatus,
      last_error lastError,created_at createdAt,updated_at updatedAt
      FROM task_moves ${where} ORDER BY created_at DESC LIMIT 200`).all(...params) as MoveRecord[];
  } finally { db.close(); }
}

export function enqueueProjectCreate(input: {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  defaultWorkdir?: string;
}) {
  const db = openState();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = `proj_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const payload = JSON.stringify({
      slug: input.slug,
      name: input.name,
      description: input.description || "",
      icon: input.icon || "◈",
      color: input.color || "#d4ff00",
      defaultWorkdir: input.defaultWorkdir || "",
    });
    db.prepare(`
      INSERT INTO commands(kind, idea_id, status, attempts, created_at, updated_at)
      VALUES('board.create', ?, 'pending', 0, ?, ?)
    `).run(payload, now, now);
    triggerBroker();
    return { id, slug: input.slug, status: "pending" };
  } finally {
    db.close();
  }
}

