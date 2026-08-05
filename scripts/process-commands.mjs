import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const dbPath = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";
const hermes = process.env.HERMES_BIN || "/usr/local/bin/hermes";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

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

try { while (runOne()) {} } finally { db.close(); }
