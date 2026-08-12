import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { ActivityEvent, AgentSummary, BoardSummary, DashboardSnapshot, TaskCard } from "./types";

const kanbanRoot = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";
const profilesRoot = process.env.HERMES_PROFILES_ROOT || "/root/.hermes/profiles";

type BoardRecord = { slug: string; name: string; description?: string; icon?: string; color?: string; dbPath: string };
type AnyRow = Record<string, unknown>;

function openReadOnly(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

export function discoverBoards(): BoardRecord[] {
  const result: BoardRecord[] = [];
  const namedRoot = path.join(kanbanRoot, "boards");
  if (fs.existsSync(namedRoot)) {
    for (const slug of fs.readdirSync(namedRoot).sort()) {
      if (slug.startsWith("_") || slug.includes("..")) continue;
      const dir = path.join(namedRoot, slug);
      const dbPath = path.join(dir, "kanban.db");
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(dbPath)) continue;
      let meta: AnyRow = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")) as AnyRow; } catch {}
      result.push({
        slug,
        name: String(meta.name || slug.replaceAll("-", " ")),
        description: String(meta.description || ""),
        icon: String(meta.icon || "◈"),
        color: String(meta.color || ""),
        dbPath,
      });
    }
  }
  const defaultDb = path.resolve(kanbanRoot, "..", "kanban.db");
  if (fs.existsSync(defaultDb)) result.unshift({ slug: "default", name: "Default", icon: "◈", color: "", dbPath: defaultDb });
  return result;
}

function boardSummary(board: BoardRecord): BoardSummary {
  const db = openReadOnly(board.dbPath);
  try {
    const counts = Object.fromEntries((db.prepare("SELECT status, COUNT(*) count FROM tasks GROUP BY status").all() as AnyRow[]).map((r) => [String(r.status), Number(r.count)]));
    const latest = db.prepare("SELECT MAX(created_at) value FROM task_events").get() as AnyRow | undefined;
    return { slug: board.slug, name: board.name, description: board.description || "", icon: board.icon || "◈", color: board.color || "", counts, lastActivityAt: latest?.value == null ? null : Number(latest.value) };
  } finally { db.close(); }
}

function readTasks(board: BoardRecord): TaskCard[] {
  const db = openReadOnly(board.dbPath);
  try {
    const rows = db.prepare("SELECT id,title,body,assignee,status,priority,created_at,started_at,completed_at,branch_name,result,block_kind,last_heartbeat_at,model_override FROM tasks WHERE status != 'archived' ORDER BY priority DESC, created_at DESC").all() as AnyRow[];
    const links = db.prepare("SELECT parent_id, child_id FROM task_links").all() as AnyRow[];
    const comments = db.prepare("SELECT id,task_id,author,body,created_at FROM task_comments ORDER BY created_at DESC").all() as AnyRow[];
    const runs = db.prepare("SELECT id,task_id,profile,status,outcome,started_at,ended_at,summary,error FROM task_runs ORDER BY id DESC").all() as AnyRow[];
    const attachments = new Map<string, number>((db.prepare("SELECT task_id, COUNT(*) count FROM task_attachments GROUP BY task_id").all() as AnyRow[]).map((r) => [String(r.task_id), Number(r.count)]));
    return rows.map((r) => {
      const id = String(r.id);
      return {
        id, title: String(r.title), body: unwrapBody(String(r.body || "")), assignee: r.assignee == null ? null : String(r.assignee), status: String(r.status), priority: Number(r.priority || 0),
        boardSlug: board.slug,
        createdAt: Number(r.created_at), startedAt: r.started_at == null ? null : Number(r.started_at), completedAt: r.completed_at == null ? null : Number(r.completed_at),
        branchName: r.branch_name == null ? null : String(r.branch_name), result: r.result == null ? null : String(r.result),
        blockKind: r.block_kind == null ? null : String(r.block_kind), lastHeartbeatAt: r.last_heartbeat_at == null ? null : Number(r.last_heartbeat_at), modelOverride: r.model_override == null ? null : String(r.model_override),
        parentIds: links.filter((l) => String(l.child_id) === id).map((l) => String(l.parent_id)), childIds: links.filter((l) => String(l.parent_id) === id).map((l) => String(l.child_id)),
        comments: comments.filter((c) => String(c.task_id) === id).map((c) => ({ id: Number(c.id), author: String(c.author), body: String(c.body), createdAt: Number(c.created_at) })),
        runs: runs.filter((run) => String(run.task_id) === id).map((run) => ({ id: Number(run.id), profile: String(run.profile || ""), status: String(run.status || ""), outcome: run.outcome == null ? null : String(run.outcome), startedAt: run.started_at == null ? null : Number(run.started_at), endedAt: run.ended_at == null ? null : Number(run.ended_at), summary: run.summary == null ? null : String(run.summary), error: run.error == null ? null : String(run.error) })),
        attachmentCount: attachments.get(id) || 0,
      };
    });
  } finally { db.close(); }
}

function unwrapBody(body: string): string {
  if (!body || !body.trimStart().startsWith("{")) return body;
  try {
    const parsed = JSON.parse(body) as { body?: unknown };
    if (typeof parsed.body === "string") return parsed.body;
  } catch {
    // Truncated JSON envelope (seen in real boards): extract the "body" string best-effort.
    const start = body.indexOf('"body":"');
    if (start !== -1) {
      const slice = body.slice(start + 8);
      let out = "";
      for (let i = 0; i < slice.length; i++) {
        const ch = slice[i];
        if (ch === "\\") { const nxt = slice[i + 1]; out += nxt === "n" ? "\n" : nxt === "t" ? "\t" : nxt === "r" ? "\r" : nxt === '"' ? '"' : nxt === "\\" ? "\\" : ch + (nxt ?? ""); i++; continue; }
        if (ch === '"') break;
        out += ch;
      }
      if (out.trim()) return out;
    }
  }
  return body;
}

function profileDescriptions(): Map<string, string> {
  const profiles = new Map<string, string>();
  for (const name of (process.env.AOC_AGENTS || "pm,coder,coder-parallel,designer,tester,reviewer").split(",").map((item) => item.trim()).filter(Boolean)) profiles.set(name, "Hermes specialist");
  if (!fs.existsSync(/* turbopackIgnore: true */ profilesRoot)) return profiles;
  for (const name of fs.readdirSync(/* turbopackIgnore: true */ profilesRoot).sort()) {
    const profilePath = path.join(profilesRoot, name, "profile.yaml");
    if (!fs.existsSync(profilePath)) continue;
    const raw = fs.readFileSync(profilePath, "utf8");
    const match = raw.match(/^description:\s*([\s\S]*?)(?=^\w|\Z)/m);
    profiles.set(name, (match?.[1] || "").replace(/\n\s+/g, " ").trim());
  }
  return profiles;
}

function agentSummaries(boards: BoardRecord[], tasksByBoard: Map<string, TaskCard[]>): AgentSummary[] {
  const descriptions = profileDescriptions();
  const names = new Set(descriptions.keys());
  for (const tasks of tasksByBoard.values()) for (const task of tasks) if (task.assignee) names.add(task.assignee);
  return [...names].sort().map((name) => {
    const all = [...tasksByBoard.entries()].flatMap(([board, tasks]) => tasks.map((task) => ({ board, task })));
    const running = all.find(({ task }) => task.assignee === name && task.status === "running");
    const blocked = all.filter(({ task }) => task.assignee === name && task.status === "blocked");
    const owned = all.filter(({ task }) => task.assignee === name);
    return { name, description: descriptions.get(name) || "Hermes specialist", status: running ? "working" : blocked.length ? "blocked" : "idle", currentTask: running?.task.title || null, currentBoard: running?.board || null, completed: owned.filter(({ task }) => task.status === "done").length, blocked: blocked.length, lastHeartbeatAt: running?.task.lastHeartbeatAt || null };
  });
}

function safeReadTasks(board: BoardRecord): TaskCard[] {
  try { return readTasks(board); } catch { return []; }
}

function safeBoardSummary(board: BoardRecord): BoardSummary {
  try { return boardSummary(board); } catch {
    return { slug: board.slug, name: board.name, description: board.description || "", icon: board.icon || "◈", color: board.color || "", counts: {}, lastActivityAt: null };
  }
}

function safeReadActivity(boards: BoardRecord[], limit = 60): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const board of boards) {
    try {
      const db = openReadOnly(board.dbPath);
      try {
        const rows = db.prepare("SELECT e.id,e.task_id,e.kind,e.payload,e.created_at,t.title,t.assignee FROM task_events e LEFT JOIN tasks t ON t.id=e.task_id ORDER BY e.created_at DESC LIMIT ?").all(limit) as AnyRow[];
        events.push(...rows.map((r) => ({ id: Number(r.id), taskId: String(r.task_id), kind: String(r.kind), payload: null, createdAt: Number(r.created_at), board: board.slug, taskTitle: String(r.title || r.task_id), assignee: r.assignee == null ? null : String(r.assignee) })));
      } finally { db.close(); }
    } catch { /* skip board */ }
  }
  return events.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

// ── Lightweight helpers for SSE live updates (avoid full snapshot rebuild) ──

export type AgentLiveStatus = {
  name: string;
  status: "working" | "blocked" | "idle";
  currentTask: string | null;
  currentBoard: string | null;
  lastHeartbeatAt: number | null;
};

export type TaskLiveDelta = {
  id: string;
  status: string;
  assignee: string | null;
  boardSlug: string;
  lastHeartbeatAt: number | null;
};

export function getAgentStatuses(): AgentLiveStatus[] {
  const boards = discoverBoards();
  const descriptions = profileDescriptions();
  const names = new Set(descriptions.keys());
  const statuses = new Map<string, { running: { title: string; board: string; heartbeat: number | null } | null; blocked: number }>();

  for (const board of boards) {
    try {
      const db = openReadOnly(board.dbPath);
      try {
        const rows = db.prepare("SELECT assignee, status, title, last_heartbeat_at FROM tasks WHERE status IN ('running','blocked') AND assignee IS NOT NULL").all() as AnyRow[];
        for (const r of rows) {
          const name = String(r.assignee);
          names.add(name);
          const entry = statuses.get(name) || { running: null, blocked: 0 };
          if (r.status === "running") entry.running = { title: String(r.title), board: board.slug, heartbeat: r.last_heartbeat_at == null ? null : Number(r.last_heartbeat_at) };
          if (r.status === "blocked") entry.blocked++;
          statuses.set(name, entry);
        }
      } finally { db.close(); }
    } catch { /* skip unreadable board */ }
  }

  return [...names].sort().map((name) => {
    const s = statuses.get(name);
    return {
      name,
      status: s?.running ? "working" : (s?.blocked && s.blocked > 0) ? "blocked" : "idle",
      currentTask: s?.running?.title || null,
      currentBoard: s?.running?.board || null,
      lastHeartbeatAt: s?.running?.heartbeat || null,
    };
  });
}

export function getTaskDeltas(): TaskLiveDelta[] {
  const boards = discoverBoards();
  const deltas: TaskLiveDelta[] = [];
  for (const board of boards) {
    try {
      const db = openReadOnly(board.dbPath);
      try {
        const rows = db.prepare("SELECT id, status, assignee, last_heartbeat_at FROM tasks WHERE status != 'archived' ORDER BY priority DESC, created_at DESC").all() as AnyRow[];
        for (const r of rows) deltas.push({ id: String(r.id), status: String(r.status), assignee: r.assignee == null ? null : String(r.assignee), boardSlug: board.slug, lastHeartbeatAt: r.last_heartbeat_at == null ? null : Number(r.last_heartbeat_at) });
      } finally { db.close(); }
    } catch { /* skip */ }
  }
  return deltas;
}

export function getSnapshot(requestedBoard?: string | null): DashboardSnapshot {
  const boards = discoverBoards();
  if (!boards.length) throw new Error("No Hermes Kanban boards found");
  const tasksByBoard = new Map(boards.map((board) => [board.slug, safeReadTasks(board)]));
  let current = "";
  try { current = fs.readFileSync(path.join(kanbanRoot, "current"), "utf8").trim(); } catch {}
  const selected = boards.find((board) => board.slug === requestedBoard) || boards.find((board) => board.slug === current) || boards[0];
  return {
    generatedAt: Date.now(), selectedBoard: selected.slug,
    boards: boards.map(safeBoardSummary),
    agents: agentSummaries(boards, tasksByBoard),
    tasks: tasksByBoard.get(selected.slug) || [],
    activity: safeReadActivity(boards),
  };
}

export function activityCursor(): string {
  return discoverBoards().map((board) => {
    try {
      const db = openReadOnly(board.dbPath);
      try { const row = db.prepare("SELECT MAX(id) id FROM task_events").get() as AnyRow | undefined; return `${board.slug}:${row?.id || 0}`; } finally { db.close(); }
    } catch { return `${board.slug}:0`; }
  }).join("|");
}
