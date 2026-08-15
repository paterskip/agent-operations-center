import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";
const defaultHermes = process.env.HERMES_BIN || "/usr/local/bin/hermes";

/**
 * @typedef {Object} TaskSnapshot
 * @property {string} id
 * @property {string} status
 */

/** @type {(board: string, args: string[]) => string} */
export function defaultExec(board, args) {
  return execFileSync(defaultHermes, hermesArgs(board, ...args), {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: "/root" }
  });
}

export function hermesArgs(board, ...args) {
  return ["kanban", "--board", board, ...args];
}

export function now() { return Math.floor(Date.now() / 1000); }

export function openDb(dbP = dbPath) {
  return new Database(dbP);
}

export function ensureTables(db) {
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

export function runOne(db, exec = defaultExec) {
  const command = db.prepare("SELECT id,idea_id ideaId FROM commands WHERE status='pending' AND attempts < 3 ORDER BY id LIMIT 1").get();
  if (!command) return false;
  const idea = db.prepare("SELECT * FROM ideas WHERE id=?").get(command.ideaId);
  const ts = now();
  if (!idea) {
    db.transaction(() => {
      db.prepare("UPDATE commands SET status='failed', updated_at=? WHERE id=?").run(ts, command.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','command.orphaned',?,?,NULL,?)")
        .run(String(command.ideaId), `command.id=${command.id}: idea not found`, ts);
    })();
    return true;
  }
  db.prepare("UPDATE commands SET status='running', attempts=attempts+1, updated_at=? WHERE id=?").run(ts, command.id);
  try {
    const body = [
      `Projekt docelowy: ${idea.project}`,
      `Pomysł CEO: ${idea.description}`,
      "Przygotuj analizę wartości, kosztu, ryzyka i rekomendację. Nie wdrażaj kodu.",
      "Jeśli potrzebny jest research, utwórz osobną kartę dla reviewera i odnotuj jej ID.",
      "Po analizie zablokuj kartę jako needs_input i poproś CEO o decyzję."
    ].join("\n\n");
    const key = createHash("sha256").update(`aoc:${idea.id}`).digest("hex");
    const output = exec("portfolio", ["create", idea.title, "--body", body, "--assignee", "pm", "--priority", String(idea.priority), "--created-by", "CEO Web", "--idempotency-key", key, "--json"]);
    const parsed = JSON.parse(output);
    const taskId = parsed.id || parsed.task_id;
    db.transaction(() => {
      db.prepare("UPDATE ideas SET status='submitted', hermes_task_id=?, last_error=NULL, updated_at=? WHERE id=?").run(taskId, ts, idea.id);
      db.prepare("UPDATE commands SET status='done', updated_at=? WHERE id=?").run(ts, command.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','hermes.create',?,?,NULL,?)").run(idea.id, taskId, ts);
    })();
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    db.transaction(() => {
      db.prepare("UPDATE commands SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END, updated_at=? WHERE id=?").run(ts, command.id);
      db.prepare("UPDATE ideas SET status='queue_error', last_error=?, updated_at=? WHERE id=?").run(message, ts, idea.id);
    })();
  }
  return true;
}

export function taskState(board, taskId, exec = defaultExec) {
  const parsed = JSON.parse(exec(board, ["show", taskId, "--json"]));
  if (!parsed?.task || parsed.task.id !== taskId) throw new Error("Task lookup mismatch");
  return parsed.task;
}

export function processDecision(db, exec = defaultExec) {
  const decision = db.prepare("SELECT id,board,task_id taskId,action,from_status fromStatus,comment FROM task_decisions WHERE status='queued' ORDER BY created_at LIMIT 1").get();
  if (!decision) return false;
  const ts = now();
  const claimed = db.prepare("UPDATE task_decisions SET status='running', updated_at=? WHERE id=? AND status='queued'").run(ts, decision.id);
  if (claimed.changes === 0) return false;
  try {
    const before = taskState(decision.board, decision.taskId, exec);
    if (before.status !== decision.fromStatus) throw new Error(`Task status changed from ${decision.fromStatus} to ${before.status}`);
    const reason = decision.comment || "Decyzja CEO: zaakceptowano do dalszej pracy. PM decyduje o przydziale.";
    if (decision.action === "approve" || decision.action === "resume") {
      if (!["blocked", "scheduled"].includes(before.status)) throw new Error(`Cannot resume task in ${before.status}`);
      exec(decision.board, ["unblock", decision.taskId, "--reason", `CEO APPROVED: ${reason}`]);
    } else if (decision.action === "reject") {
      if (before.status === "blocked") exec(decision.board, ["comment", decision.taskId, `CEO REJECTED: ${reason}`, "--author", "CEO Web", "--max-len", "2000"]);
      else if (["ready", "running"].includes(before.status)) exec(decision.board, ["block", decision.taskId, `CEO REJECTED: ${reason}`, "--kind", "needs_input"]);
      else throw new Error(`Cannot reject task in ${before.status}`);
    } else if (decision.action === "hold") {
      if (!["todo", "ready", "running"].includes(before.status)) throw new Error(`Cannot hold task in ${before.status}`);
      exec(decision.board, ["block", decision.taskId, `CEO HOLD: ${reason}`, "--kind", "needs_input"]);
    } else throw new Error("Unknown decision action");
    const after = taskState(decision.board, decision.taskId, exec);
    const allowed = decision.action === "approve" || decision.action === "resume" ? ["ready", "todo"] : ["blocked", "triage"];
    if (!allowed.includes(after.status)) throw new Error(`Unexpected resulting status ${after.status}`);
    db.transaction(() => {
      db.prepare("UPDATE task_decisions SET status='done', result_status=?, last_error=NULL, updated_at=? WHERE id=?").run(after.status, ts, decision.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker',?,?,?,NULL,?)")
        .run(`task.${decision.action}.done`, `${decision.board}/${decision.taskId}`, `${before.status}->${after.status}; decision=${decision.id}`, ts);
    })();
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    db.transaction(() => {
      db.prepare("UPDATE task_decisions SET status='failed', last_error=?, updated_at=? WHERE id=?").run(message, ts, decision.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','task.decision.failed',?,?,NULL,?)")
        .run(`${decision.board}/${decision.taskId}`, `${decision.id}: ${message}`, ts);
    })();
  }
  return true;
}

export function processMove(db, exec = defaultExec) {
  const move = db.prepare("SELECT id,board,task_id taskId,action,from_status fromStatus,to_status toStatus,title,body,assignee,priority,comment FROM task_moves WHERE status='queued' ORDER BY created_at LIMIT 1").get();
  if (!move) return false;
  const ts = now();
  const claimed = db.prepare("UPDATE task_moves SET status='running', updated_at=? WHERE id=? AND status='queued'").run(ts, move.id);
  if (claimed.changes === 0) return false;
  try {
    if (move.action === "create") {
      const args = ["create", move.title, "--body", move.body || "Created from AOC panel",
        "--priority", String(move.priority || 2), "--json"];
      if (move.assignee) args.push("--assignee", move.assignee);
      args.push("--created-by", "CEO Web", "--idempotency-key", createHash("sha256").update(`aoc-move:${move.id}`).digest("hex"));
      const output = exec(move.board, args);
      const parsed = JSON.parse(output);
      const createdId = parsed.id || parsed.task_id;
      db.transaction(() => {
        db.prepare("UPDATE task_moves SET status='done', result_status=?, last_error=NULL, updated_at=? WHERE id=?")
          .run(`created:${createdId}`, ts, move.id);
        db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','task.create.done',?,?,NULL,?)")
          .run(`${move.board}/${createdId}`, `move.id=${move.id}`, ts);
      })();
    } else {
      const task = taskState(move.board, move.taskId, exec);
      if (task.status !== move.fromStatus) throw new Error(`Task status changed from ${move.fromStatus} to ${task.status}`);

      const transition = `${move.fromStatus}→${move.toStatus}`;

      if (move.fromStatus === "todo" && move.toStatus === "scheduled") {
        exec(move.board, ["schedule", move.taskId, "CEO scheduled via Kanban panel"]);
      } else if (move.fromStatus === "ready" && move.toStatus === "running") {
        exec(move.board, ["claim", move.taskId, "--ttl", "3600"]);
      } else if (move.fromStatus === "running" && move.toStatus === "blocked") {
        exec(move.board, ["block", move.taskId, "CEO blocked via Kanban panel", "--kind", "needs_input"]);
      } else if (move.fromStatus === "running" && move.toStatus === "review") {
        const result = move.comment.includes("CEO drag") ? "Moved to review by CEO" : move.comment;
        exec(move.board, ["complete", move.taskId, "--result", result]);
      } else if (move.fromStatus === "review" && move.toStatus === "ready") {
        exec(move.board, ["reopen-review", move.taskId, "--reason", "CEO sent back: review→ready"]);
      } else {
        throw new Error(`Unsupported transition: ${transition}`);
      }

      const after = taskState(move.board, move.taskId, exec);
      if (after.status === move.fromStatus && move.toStatus !== move.fromStatus) {
        throw new Error(`Transition ${transition} did not change status (still '${after.status}')`);
      }
      db.transaction(() => {
        db.prepare("UPDATE task_moves SET status='done', result_status=?, last_error=NULL, updated_at=? WHERE id=?")
          .run(after.status, ts, move.id);
        db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','task.move.done',?,?,NULL,?)")
          .run(`${move.board}/${move.taskId}`, `${move.fromStatus}->${after.status}; move.id=${move.id}`, ts);
      })();
    }
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    db.transaction(() => {
      db.prepare("UPDATE task_moves SET status='failed', last_error=?, updated_at=? WHERE id=?").run(message, ts, move.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','task.move.failed',?,?,NULL,?)")
        .run(`${move.board}/${move.taskId}`, `${move.id}: ${message}`, ts);
    })();
  }
  return true;
}

// ── Backup: every 5 minutes, keep 24 copies per board ──
const BACKUP_MS = 5 * 60 * 1000;
const BACKUP_KEEP = 24;

export function backupKanban(opts = {}) {
  const stateDb = opts.stateDbPath || process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";
  const stampFile = path.join(path.dirname(stateDb), ".aoc-last-backup");
  const nowMs = Date.now();
  try {
    const lastMs = Number(fs.readFileSync(stampFile, "utf8").trim());
    if (!Number.isNaN(lastMs) && nowMs - lastMs < BACKUP_MS) return;
  } catch {}
  const kanbanRoot = opts.kanbanRoot || process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";
  const boardsDir = path.join(kanbanRoot, "boards");
  const backupDir = path.join(kanbanRoot, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultDb = path.join(kanbanRoot, "..", "kanban.db");
  if (fs.existsSync(defaultDb)) {
    try {
      const c = new Database(defaultDb);
      try { c.pragma("wal_checkpoint(TRUNCATE)"); } finally { c.close(); }
    } catch { /* busy */ }
    fs.copyFileSync(defaultDb, path.join(backupDir, `default-${ts}.db`));
  }
  const boardSlugs = fs.existsSync(boardsDir) ? fs.readdirSync(boardsDir) : [];
  for (const slug of boardSlugs) {
    if (slug.startsWith("_") || slug.includes("..")) continue;
    const src = path.join(boardsDir, slug, "kanban.db");
    if (!fs.existsSync(src)) continue;
    const dest = path.join(backupDir, `${slug}-${ts}.db`);
    try {
      const checkpoint = new Database(src);
      try { checkpoint.pragma("wal_checkpoint(TRUNCATE)"); } finally { checkpoint.close(); }
    } catch { /* busy */ }
    fs.copyFileSync(src, dest);
  }
  for (const slug of boardSlugs) {
    if (slug.startsWith("_") || slug.includes("..")) continue;
    const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith(`${slug}-`) && f.endsWith(".db")).sort().reverse();
    for (const old of backups.slice(BACKUP_KEEP)) fs.unlinkSync(path.join(backupDir, old));
    const defBackups = fs.readdirSync(backupDir).filter((f) => f.startsWith("default-") && f.endsWith(".db")).sort().reverse();
    for (const old of defBackups.slice(BACKUP_KEEP)) fs.unlinkSync(path.join(backupDir, old));
  }
  fs.writeFileSync(stampFile, String(nowMs));
}

export function checkpointAll(opts = {}) {
  try {
    const kanbanRoot = opts.kanbanRoot || process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";
    const boardsDir = path.join(kanbanRoot, "boards");
    const statePaths = [
      path.join(kanbanRoot, "..", "kanban.db"),
      "/root/.hermes/state.db",
      "/root/.hermes/profiles/pm/state.db",
      "/root/.hermes/profiles/reviewer/state.db",
      "/root/.hermes/profiles/coder/state.db",
      "/root/.hermes/profiles/coder-parallel/state.db",
      "/root/.hermes/profiles/designer/state.db",
      "/root/.hermes/profiles/tester/state.db",
    ];
    if (fs.existsSync(boardsDir)) {
      for (const slug of fs.readdirSync(boardsDir)) {
        if (slug.startsWith("_") || slug.includes("..")) continue;
        statePaths.push(path.join(boardsDir, slug, "kanban.db"));
      }
    }
    for (const statePath of statePaths) {
      if (fs.existsSync(statePath)) {
        try {
          const hdb = new Database(statePath);
          hdb.pragma("wal_checkpoint(TRUNCATE)");
          hdb.close();
        } catch { /* skip */ }
      }
    }
  } catch { /* checkpoint is best-effort */ }
}

export function initDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  ensureTables(db);
  return db;
}

export function main() {
  const db = initDb();
  try {
    backupKanban();
    const hadWork = runOne(db) || processDecision(db) || processMove(db);
    if (hadWork) checkpointAll();
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
