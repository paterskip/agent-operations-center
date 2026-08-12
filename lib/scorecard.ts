import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { agentDisplayName } from "./hermes";

const kanbanRoot = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";

type AnyRow = Record<string, unknown>;

export type AgentScorecardRow = {
  slug: string;
  name: string;
  done7: number;
  done30: number;
  blocked7: number;
  blocked30: number;
  created30: number;
  rework30: number; // tasks completed more than once in 30d (rework proxy)
  running: number;
  total: number;
  sessions30: number; // kanban work sessions in 30d (from profile state.db)
  tokens30: number;
  cost30: number | null; // USD (null when the profile DB is unavailable)
};

function discoverBoards(): string[] {
  const dir = path.join(kanbanRoot, "boards");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((slug) => !slug.startsWith("_") && !slug.includes("..") && fs.existsSync(path.join(dir, slug, "kanban.db"))).sort();
}

export function getScorecard(): AgentScorecardRow[] {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 3600;
  const rows = new Map<string, AgentScorecardRow>();
  const completions = new Map<string, { count: number; assignee: string | null }>(); // taskId -> rework proxy

  for (const board of discoverBoards()) {
    let db: Database.Database | null = null;
    try {
      db = new Database(path.join(kanbanRoot, "boards", board, "kanban.db"), { readonly: true, fileMustExist: true });
      db.pragma("query_only = ON");
      const tasks = db.prepare("SELECT id,assignee,status FROM tasks WHERE status != 'archived'").all() as AnyRow[];
      const events = db.prepare("SELECT task_id, kind, created_at FROM task_events").all() as AnyRow[];

      for (const e of events) {
        const age = now - Number(e.created_at);
        const tid = String(e.task_id);
        if (e.kind === "completed" && age < 30 * day) {
          const c = completions.get(tid) || { count: 0, assignee: null };
          c.count++;
          completions.set(tid, c);
        }
        if (age >= 30 * day) continue;
        const task = tasks.find((t) => String(t.id) === tid);
        if (!task || !task.assignee) continue;
        const slug = String(task.assignee);
        const row = rows.get(slug) || { slug, name: agentDisplayName(slug), done7: 0, done30: 0, blocked7: 0, blocked30: 0, created30: 0, rework30: 0, running: 0, total: 0, sessions30: 0, tokens30: 0, cost30: null };
        if (e.kind === "completed") { row.done30++; if (age < 7 * day) row.done7++; }
        if (e.kind === "blocked") { row.blocked30++; if (age < 7 * day) row.blocked7++; }
        if (e.kind === "created") row.created30++;
        rows.set(slug, row);
      }

      for (const t of tasks) {
        if (!t.assignee) continue;
        const slug = String(t.assignee);
        const row = rows.get(slug) || { slug, name: agentDisplayName(slug), done7: 0, done30: 0, blocked7: 0, blocked30: 0, created30: 0, rework30: 0, running: 0, total: 0, sessions30: 0, tokens30: 0, cost30: null };
        row.total++;
        if (t.status === "running") row.running++;
        rows.set(slug, row);
        const tid = String(t.id);
        if (completions.has(tid)) completions.get(tid)!.assignee = slug;
      }
    } catch { /* skip unreadable board */ } finally {
      if (db) db.close();
    }
  }

  for (const { count, assignee } of completions.values()) {
    if (count <= 1 || !assignee) continue;
    const row = rows.get(assignee);
    if (row) row.rework30++;
  }

  // Per-agent kanban usage from Hermes profile state DBs (sessions with source='kanban')
  const profilesRoot = process.env.HERMES_PROFILES_ROOT || "/root/.hermes/profiles";
  const usageFrom = now - 30 * day;
  for (const row of rows.values()) {
    const statePath = row.slug === "default" ? path.resolve(profilesRoot, "..", "state.db") : path.join(profilesRoot, row.slug, "state.db");
    if (!fs.existsSync(statePath)) { row.cost30 = null; continue; }
    try {
      const db = new Database(statePath, { readonly: true, fileMustExist: true });
      try {
        const agg = db.prepare(
          "SELECT COUNT(*) sessions, COALESCE(SUM(input_tokens),0)+COALESCE(SUM(output_tokens),0)+COALESCE(SUM(cache_read_tokens),0)+COALESCE(SUM(cache_write_tokens),0) tokens, COALESCE(SUM(estimated_cost_usd),0) cost FROM sessions WHERE source='kanban' AND started_at >= ?"
        ).get(usageFrom) as AnyRow;
        row.sessions30 = Number(agg.sessions || 0);
        row.tokens30 = Number(agg.tokens || 0);
        row.cost30 = Number(agg.cost || 0);
      } finally { db.close(); }
    } catch { row.cost30 = null; }
  }

  return [...rows.values()].sort((a, b) => b.done30 - a.done30);
}
