import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";
const hermes = process.env.HERMES_BIN || "/usr/local/bin/hermes";

// ── Ensure state tables exist (idempotent) ──
{
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
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

function now() { return Math.floor(Date.now() / 1000); }

function runOne() {
  const command = db.prepare("SELECT id,idea_id ideaId FROM commands WHERE status='pending' AND attempts < 3 ORDER BY id LIMIT 1").get();
  if (!command) return false;
  const idea = db.prepare("SELECT * FROM ideas WHERE id=?").get(command.ideaId);
  const ts = now();
  if (!idea) {
    // Orphaned command (idea deleted): fail it instead of crashing the broker.
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
      `Pomys\u0142 CEO: ${idea.description}`,
      "Przygotuj analiz\u0119 warto\u015bci, kosztu, ryzyka i rekomendacj\u0119. Nie wdra\u017caj kodu.",
      "Je\u015bli potrzebny jest research, utw\u00f3rz osobn\u0105 kart\u0119 dla reviewera i odnotuj jej ID.",
      "Po analizie zablokuj kart\u0119 jako needs_input i popro\u015b CEO o decyzj\u0119."
    ].join("\n\n");
    const key = createHash("sha256").update(`aoc:${idea.id}`).digest("hex");
    const output = execFileSync(hermes, ["kanban", "--board", "portfolio", "create", idea.title, "--body", body, "--assignee", "pm", "--priority", String(idea.priority), "--created-by", "CEO Web", "--idempotency-key", key, "--json"], {
      encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: "/root" }
    });
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

function hermesArgs(board, ...args) {
  return ["kanban", "--board", board, ...args];
}

function runHermes(board, args) {
  return execFileSync(hermes, hermesArgs(board, ...args), {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: "/root" }
  });
}

function taskState(board, taskId) {
  const parsed = JSON.parse(runHermes(board, ["show", taskId, "--json"]));
  if (!parsed?.task || parsed.task.id !== taskId) throw new Error("Task lookup mismatch");
  return parsed.task;
}

function processDecision() {
  const decision = db.prepare("SELECT id,board,task_id taskId,action,from_status fromStatus,comment FROM task_decisions WHERE status='queued' ORDER BY created_at LIMIT 1").get();
  if (!decision) return false;
  const ts = now();
  db.prepare("UPDATE task_decisions SET status='running', updated_at=? WHERE id=? AND status='queued'").run(ts, decision.id);
  try {
    const before = taskState(decision.board, decision.taskId);
    if (before.status !== decision.fromStatus) throw new Error(`Task status changed from ${decision.fromStatus} to ${before.status}`);
    const reason = decision.comment || "Decyzja CEO: zaakceptowano do dalszej pracy. PM decyduje o przydziale.";
    if (decision.action === "approve" || decision.action === "resume") {
      if (!["blocked", "scheduled"].includes(before.status)) throw new Error(`Cannot resume task in ${before.status}`);
      runHermes(decision.board, ["unblock", decision.taskId, "--reason", `CEO APPROVED: ${reason}`]);
    } else if (decision.action === "reject") {
      if (before.status === "blocked") runHermes(decision.board, ["comment", decision.taskId, `CEO REJECTED: ${reason}`, "--author", "CEO Web", "--max-len", "2000"]);
      else if (["ready", "running"].includes(before.status)) runHermes(decision.board, ["block", decision.taskId, `CEO REJECTED: ${reason}`, "--kind", "needs_input"]);
      else throw new Error(`Cannot reject task in ${before.status}`);
    } else if (decision.action === "hold") {
      if (!["todo", "ready", "running"].includes(before.status)) throw new Error(`Cannot hold task in ${before.status}`);
      runHermes(decision.board, ["block", decision.taskId, `CEO HOLD: ${reason}`, "--kind", "needs_input"]);
    } else throw new Error("Unknown decision action");
    const after = taskState(decision.board, decision.taskId);
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

function processMove() {
  const move = db.prepare("SELECT id,board,task_id taskId,action,from_status fromStatus,to_status toStatus,title,body,assignee,priority,comment FROM task_moves WHERE status='queued' ORDER BY created_at LIMIT 1").get();
  if (!move) return false;
  const ts = now();
  db.prepare("UPDATE task_moves SET status='running', updated_at=? WHERE id=? AND status='queued'").run(ts, move.id);
  try {
    if (move.action === "create") {
      const args = ["create", move.title, "--body", move.body || "Created from AOC panel",
        "--priority", String(move.priority || 2), "--json"];
      if (move.assignee) args.push("--assignee", move.assignee);
      args.push("--created-by", "CEO Web", "--idempotency-key", createHash("sha256").update(`aoc-move:${move.id}`).digest("hex"));
      const output = runHermes(move.board, args);
      const parsed = JSON.parse(output);
      const createdId = parsed.id || parsed.task_id;
      db.transaction(() => {
        db.prepare("UPDATE task_moves SET status='done', result_status=?, last_error=NULL, updated_at=? WHERE id=?")
          .run(`created:${createdId}`, ts, move.id);
        db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','task.create.done',?,?,NULL,?)")
          .run(`${move.board}/${createdId}`, `move.id=${move.id}`, ts);
      })();
    } else {
      const task = taskState(move.board, move.taskId);
      if (task.status !== move.fromStatus) throw new Error(`Task status changed from ${move.fromStatus} to ${task.status}`);

      const transition = `${move.fromStatus}\u2192${move.toStatus}`;

      if (move.fromStatus === "triage" && move.toStatus === "todo") {
        // `specify` to jedyna komenda, ktora realnie przenosi triage -> todo.
        // Wczesniej dodawany byl tylko komentarz, wiec karta zostawala w triage.
        runHermes(move.board, ["specify", move.taskId, "--author", "CEO Web"]);
        runHermes(move.board, ["comment", move.taskId, `CEO moved: ${transition}`, "--author", "CEO Web", "--max-len", "2000"]);
      } else if (move.fromStatus === "todo" && move.toStatus === "scheduled") {
        runHermes(move.board, ["schedule", move.taskId, "CEO scheduled via Kanban panel"]);
      } else if (move.fromStatus === "scheduled" && move.toStatus === "todo") {
        runHermes(move.board, ["comment", move.taskId, `CEO descheduled: ${transition}`, "--author", "CEO Web", "--max-len", "2000"]);
      } else if (move.fromStatus === "scheduled" && move.toStatus === "ready") {
        runHermes(move.board, ["promote", move.taskId, "CEO promoted via Kanban panel"]);
      } else if (move.fromStatus === "ready" && move.toStatus === "todo") {
        runHermes(move.board, ["comment", move.taskId, `CEO moved back to todo: ${transition}`, "--author", "CEO Web", "--max-len", "2000"]);
      } else if (move.fromStatus === "ready" && move.toStatus === "running") {
        runHermes(move.board, ["promote", move.taskId, "CEO promoted via Kanban panel"]);
      } else if (move.fromStatus === "running" && move.toStatus === "blocked") {
        runHermes(move.board, ["block", move.taskId, "CEO blocked via Kanban panel", "--kind", "needs_input"]);
      } else if (move.fromStatus === "running" && move.toStatus === "review") {
        const result = move.comment.includes("CEO drag") ? "Moved to review by CEO" : move.comment;
        runHermes(move.board, ["complete", move.taskId, "--result", result]);
      } else if (move.fromStatus === "review" && move.toStatus === "done") {
        runHermes(move.board, ["comment", move.taskId, `CEO accepted review: ${transition}`, "--author", "CEO Web", "--max-len", "2000"]);
      } else if (move.fromStatus === "done" && move.toStatus === "todo") {
        runHermes(move.board, ["comment", move.taskId, `CEO reopened: ${transition}`, "--author", "CEO Web", "--max-len", "2000"]);
      } else {
        throw new Error(`Unsupported transition: ${transition}`);
      }

      const after = taskState(move.board, move.taskId);
      // Fail-closed: jesli status faktycznie sie nie zmienil, to NIE jest sukces.
      // Wczesniej broker raportowal 'done' mimo ze karta nie drgnela.
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

// ── Backup: every 5 minutes (was every cycle/5s), keep 24 copies per board ──
const BACKUP_MS = 5 * 60 * 1000; // 5 minutes
const BACKUP_KEEP = 24; // keep last 24 copies (~2 hours)

function backupKanban() {
  const stampFile = "/tmp/aoc-last-backup";
  const nowMs = Date.now();
  try {
    const lastMs = Number(fs.readFileSync(stampFile, "utf8").trim());
    if (!Number.isNaN(lastMs) && nowMs - lastMs < BACKUP_MS) return;
  } catch {}
  const kanbanRoot = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";
  const boardsDir = path.join(kanbanRoot, "boards");
  const backupDir = path.join(kanbanRoot, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const slug of fs.readdirSync(boardsDir)) {
    if (slug.startsWith("_") || slug.includes("..")) continue;
    const src = path.join(boardsDir, slug, "kanban.db");
    if (!fs.existsSync(src)) continue;
    const dest = path.join(backupDir, `${slug}-${timestamp}.db`);
    // WAL consistency: try to checkpoint the board DB first (best-effort — Hermes
    // may hold a write lock). better-sqlite3 13.x backup() crashes the process
    // after completing, so we copy the file directly like before.
    try {
      const checkpoint = new Database(src);
      try { checkpoint.pragma("wal_checkpoint(TRUNCATE)"); } finally { checkpoint.close(); }
    } catch { /* busy — copy what is there */ }
    fs.copyFileSync(src, dest);
  }
  for (const slug of fs.readdirSync(boardsDir)) {
    if (slug.startsWith("_") || slug.includes("..")) continue;
    const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith(`${slug}-`) && f.endsWith(".db")).sort().reverse();
    for (const old of backups.slice(BACKUP_KEEP)) fs.unlinkSync(path.join(backupDir, old));
  }
  fs.writeFileSync(stampFile, String(nowMs));
}

// ── WAL checkpoint: flush WAL to main DB after processing ──
function checkpointAll() {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    // Also checkpoint Hermes state DBs
    for (const statePath of [
      "/root/.hermes/state.db",
      "/root/.hermes/profiles/pm/state.db",
      "/root/.hermes/profiles/reviewer/state.db",
      "/root/.hermes/profiles/coder/state.db",
      "/root/.hermes/profiles/coder-parallel/state.db",
      "/root/.hermes/profiles/designer/state.db",
      "/root/.hermes/profiles/tester/state.db",
    ]) {
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

try { backupKanban(); const hadWork = runOne() || processDecision() || processMove(); if (hadWork) checkpointAll(); } finally { db.close(); }
