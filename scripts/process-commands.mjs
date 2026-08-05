import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const dbPath = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";
const hermes = process.env.HERMES_BIN || "/usr/local/bin/hermes";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS task_decisions (
    id TEXT PRIMARY KEY, board TEXT NOT NULL, task_id TEXT NOT NULL, action TEXT NOT NULL,
    from_status TEXT NOT NULL, to_status TEXT, comment TEXT NOT NULL, status TEXT NOT NULL,
    result_status TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_decisions_pending
    ON task_decisions(board, task_id) WHERE status IN ('queued','running');
`);

function runOne() {
  const command = db.prepare("SELECT id,idea_id ideaId FROM commands WHERE status='pending' AND attempts < 3 ORDER BY id LIMIT 1").get();
  if (!command) return false;
  const idea = db.prepare("SELECT * FROM ideas WHERE id=?").get(command.ideaId);
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE commands SET status='running', attempts=attempts+1, updated_at=? WHERE id=?").run(now, command.id);
  try {
    const body = [
      `Projekt docelowy: ${idea.project}`,
      `Pomysł CEO: ${idea.description}`,
      "Przygotuj analizę wartości, kosztu, ryzyka i rekomendację. Nie wdrażaj kodu.",
      "Jeśli potrzebny jest research, utwórz osobną kartę dla reviewera i odnotuj jej ID.",
      "Po analizie zablokuj kartę jako needs_input i poproś CEO o decyzję."
    ].join("\n\n");
    const key = createHash("sha256").update(`aoc:${idea.id}`).digest("hex");
    const output = execFileSync(hermes, ["kanban", "--board", "portfolio", "create", idea.title, "--body", body, "--assignee", "pm", "--priority", String(idea.priority), "--created-by", "CEO Web", "--idempotency-key", key, "--json"], {
      encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: "/root" }
    });
    const parsed = JSON.parse(output);
    const taskId = parsed.id || parsed.task_id;
    db.transaction(() => {
      db.prepare("UPDATE ideas SET status='submitted', hermes_task_id=?, last_error=NULL, updated_at=? WHERE id=?").run(taskId, now, idea.id);
      db.prepare("UPDATE commands SET status='done', updated_at=? WHERE id=?").run(now, command.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','hermes.create',?,?,NULL,?)").run(idea.id, taskId, now);
    })();
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    db.transaction(() => {
      db.prepare("UPDATE commands SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END, updated_at=? WHERE id=?").run(now, command.id);
      db.prepare("UPDATE ideas SET status='queue_error', last_error=?, updated_at=? WHERE id=?").run(message, now, idea.id);
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
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE task_decisions SET status='running', updated_at=? WHERE id=? AND status='queued'").run(now, decision.id);
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
      db.prepare("UPDATE task_decisions SET status='done', result_status=?, last_error=NULL, updated_at=? WHERE id=?").run(after.status, now, decision.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker',?,?,?,NULL,?)")
        .run(`task.${decision.action}.done`, `${decision.board}/${decision.taskId}`, `${before.status}->${after.status}; decision=${decision.id}`, now);
    })();
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    db.transaction(() => {
      db.prepare("UPDATE task_decisions SET status='failed', last_error=?, updated_at=? WHERE id=?").run(message, now, decision.id);
      db.prepare("INSERT INTO audit_log(actor,action,target,detail,ip,created_at) VALUES('broker','task.decision.failed',?,?,NULL,?)")
        .run(`${decision.board}/${decision.taskId}`, `${decision.id}: ${message}`, now);
    })();
  }
  return true;
}

try { while (runOne() || processDecision()) {} } finally { db.close(); }
