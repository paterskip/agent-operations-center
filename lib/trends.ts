import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const kanbanRoot = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";

export type TrendPoint = { date: string; completed: number; blocked: number };
export type AgentActivityCell = { agent: string; date: string; count: number };

function dayKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function getTrends(): { throughput: TrendPoint[]; agentActivity: AgentActivityCell[] } {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 3600;
  const throughput = new Map<string, { completed: number; blocked: number }>();
  const agentActivity = new Map<string, number>();

  const boardsDir = path.join(kanbanRoot, "boards");
  const boards: string[] = [];
  try { for (const s of fs.readdirSync(boardsDir)) if (!s.startsWith("_") && !s.includes("..")) boards.push(s); } catch { /* no boards dir */ }

  const dbPaths = [
    path.join(kanbanRoot, "..", "kanban.db"),
    ...boards.map((s) => path.join(boardsDir, s, "kanban.db")),
  ];

  for (const p of dbPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const db = new Database(p, { readonly: true, fileMustExist: true });
      try {
        const rows = db.prepare(
          "SELECT e.kind, e.created_at, t.assignee FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id WHERE e.created_at > ?",
        ).all(now - 30 * day) as { kind: string; created_at: number; assignee: string | null }[];
        for (const r of rows) {
          const dk = dayKey(r.created_at);
          if (r.kind === "completed" || r.kind === "blocked") {
            const cur = throughput.get(dk) || { completed: 0, blocked: 0 };
            if (r.kind === "completed") cur.completed += 1; else cur.blocked += 1;
            throughput.set(dk, cur);
          }
          if (r.assignee) {
            const k = `${r.assignee}|${dk}`;
            agentActivity.set(k, (agentActivity.get(k) || 0) + 1);
          }
        }
      } finally { db.close(); }
    } catch { /* skip unreadable board */ }
  }

  const throughputArr: TrendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const dk = dayKey(now - i * day);
    const v = throughput.get(dk) || { completed: 0, blocked: 0 };
    throughputArr.push({ date: dk, completed: v.completed, blocked: v.blocked });
  }

  const agentActivityArr: AgentActivityCell[] = [...agentActivity.entries()].map(([k, count]) => {
    const idx = k.lastIndexOf("|");
    return { agent: k.slice(0, idx), date: k.slice(idx + 1), count };
  });

  return { throughput: throughputArr, agentActivity: agentActivityArr };
}
