import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ActivityEvent, AgentSummary, BoardSummary, DashboardSnapshot, TaskCard } from "./types";
import type { ActivityEntry } from "./kanban-delta";
import { unwrapBody } from "./body-unwrap";

const kanbanRoot = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";
const profilesRoot = process.env.HERMES_PROFILES_ROOT || "/root/.hermes/profiles";

type BoardRecord = { slug: string; name: string; description?: string; icon?: string; color?: string; dbPath: string };
type AnyRow = Record<string, unknown>;

function openReadOnly(dbPath: string) {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    return db;
  } catch (err) {
    // Docker: the kanban mount is read-only and -wal/-shm are not mounted
    // (SQLite deletes them when the last connection closes). A WAL-mode DB
    // cannot be opened read-only there — copy the (broker-checkpointed) main
    // file to the writable tmp dir and read the copy. Stale temp copies are
    // swept on each fallback open.
    if (err instanceof Error && /readonly/i.test(err.message)) {
      const prefix = `aoc-db-${path.basename(dbPath)}-`;
      const tmpDir = os.tmpdir();
      try {
        const cutoff = Date.now() - 3600_000;
        for (const f of fs.readdirSync(tmpDir)) {
          if (!f.startsWith(prefix)) continue;
          const full = path.join(tmpDir, f);
          try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch {}
        }
      } catch {}
      const copyPath = path.join(tmpDir, `${prefix}${process.pid}-${Date.now()}.db`);
      fs.copyFileSync(dbPath, copyPath);
      const db = new Database(copyPath, { readonly: true, fileMustExist: true });
      db.pragma("query_only = ON");
      return db;
    }
    throw err;
  }
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

const fallbackNames: Record<string, string> = {
  pm: "Product Manager",
  "coder-backend": "Backend Engineer",
  "coder-frontend": "Frontend Engineer",
  coder: "Fullstack Engineer",
  "coder-parallel": "Parallel Execution Worker",
  designer: "Product Designer",
  tester: "QA Automation Engineer",
  reviewer: "Code Reviewer & Gate",
  security: "Security & AppSec Engineer",
  sec: "Security & AppSec Engineer",
  default: "Operations Specialist",
};

const fallbackDescriptions: Record<string, string> = {
  pm: "Product discovery, task specification & decomposition",
  "coder-backend": "Backend architecture, APIs, databases & security infrastructure",
  "coder-frontend": "React UI engineering, design systems, styling & UX performance",
  coder: "End-to-end fullstack engineering & rapid feature delivery",
  "coder-parallel": "Concurrent batch execution & distributed workers",
  designer: "UI/UX design systems & component architecture",
  tester: "Automated regression, integration & quality assurance",
  reviewer: "Security inspection, code review & quality gates",
  security: "AppSec audits, vulnerability assessment, CVE tracking & threat modeling",
  sec: "AppSec audits, vulnerability assessment, CVE tracking & threat modeling",
  default: "General task execution & operations",
};

function profileMeta(): Map<string, { name: string; description: string }> {
  const profiles = new Map<string, { name: string; description: string }>();
  for (const slug of (process.env.AOC_AGENTS || "pm,coder-backend,coder-frontend,coder,coder-parallel,designer,tester,reviewer,security").split(",").map((item) => item.trim()).filter(Boolean)) {
    profiles.set(slug, {
      name: fallbackNames[slug] || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: fallbackDescriptions[slug] || "Hermes operations specialist",
    });
  }
  if (!fs.existsSync(/* turbopackIgnore: true */ profilesRoot)) return profiles;
  for (const slug of fs.readdirSync(/* turbopackIgnore: true */ profilesRoot).sort()) {
    const profilePath = path.join(profilesRoot, slug, "profile.yaml");
    if (!fs.existsSync(profilePath)) continue;
    const raw = fs.readFileSync(profilePath, "utf8");
    const nameMatch = raw.match(/^name:\s*(.+)$/m);
    const descMatch = raw.match(/^description:\s*([\s\S]*?)(?=^\w|\Z)/m);
    const fallback = profiles.get(slug);
    profiles.set(slug, {
      name: (nameMatch?.[1] || "").trim() || fallback?.name || fallbackNames[slug] || slug,
      description: (descMatch?.[1] || "").replace(/\n\s+/g, " ").trim() || fallback?.description || fallbackDescriptions[slug] || "Hermes operations specialist",
    });
  }
  return profiles;
}

export function agentDisplayName(slug: string): string {
  const meta = profileMeta();
  return meta.get(slug)?.name || fallbackNames[slug] || (slug === "default" ? "Operations Specialist" : slug);
}

function agentSummaries(boards: BoardRecord[], tasksByBoard: Map<string, TaskCard[]>): AgentSummary[] {
  const meta = profileMeta();
  const slugs = new Set(meta.keys());
  for (const tasks of tasksByBoard.values()) for (const task of tasks) if (task.assignee) slugs.add(task.assignee);
  return [...slugs].sort().map((slug) => {
    const all = [...tasksByBoard.entries()].flatMap(([board, tasks]) => tasks.map((task) => ({ board, task })));
    const running = all.find(({ task }) => task.assignee === slug && task.status === "running");
    const blocked = all.filter(({ task }) => task.assignee === slug && task.status === "blocked");
    const owned = all.filter(({ task }) => task.assignee === slug);
    const m = meta.get(slug);
    return { slug, name: m?.name || (slug === "default" ? "Default Agent" : slug), description: m?.description || "Hermes specialist", status: running ? "working" : blocked.length ? "blocked" : "idle", currentTask: running?.task.title || null, currentBoard: running?.board || null, completed: owned.filter(({ task }) => task.status === "done").length, blocked: blocked.length, lastHeartbeatAt: running?.task.lastHeartbeatAt || null };
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
  slug: string;
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
  board: string;
  lastHeartbeatAt: number | null;
};

export function getAgentStatuses(): AgentLiveStatus[] {
  const boards = discoverBoards();
  const meta = profileMeta();
  const slugs = new Set(meta.keys());
  const statuses = new Map<string, { running: { title: string; board: string; heartbeat: number | null } | null; blocked: number }>();

  for (const board of boards) {
    try {
      const db = openReadOnly(board.dbPath);
      try {
        const rows = db.prepare("SELECT assignee, status, title, last_heartbeat_at FROM tasks WHERE status IN ('running','blocked') AND assignee IS NOT NULL").all() as AnyRow[];
        for (const r of rows) {
          const slug = String(r.assignee);
          slugs.add(slug);
          const entry = statuses.get(slug) || { running: null, blocked: 0 };
          if (r.status === "running") entry.running = { title: String(r.title), board: board.slug, heartbeat: r.last_heartbeat_at == null ? null : Number(r.last_heartbeat_at) };
          if (r.status === "blocked") entry.blocked++;
          statuses.set(slug, entry);
        }
      } finally { db.close(); }
    } catch { /* skip unreadable board */ }
  }

  return [...slugs].sort().map((slug) => {
    const s = statuses.get(slug);
    const m = meta.get(slug);
    return {
      slug,
      name: m?.name || (slug === "default" ? "Default Agent" : slug),
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
        for (const r of rows) deltas.push({ id: String(r.id), status: String(r.status), assignee: r.assignee == null ? null : String(r.assignee), board: board.slug, lastHeartbeatAt: r.last_heartbeat_at == null ? null : Number(r.last_heartbeat_at) });
      } finally { db.close(); }
    } catch { /* skip */ }
  }
  return deltas;
}

export function getSnapshot(requestedBoard?: string | null): DashboardSnapshot {
  const boards = discoverBoards();
  if (!boards.length) {
    // Empty state is valid, not a server fault. Return a minimal snapshot so
    // callers (snapshot GET, tasks POST/PATCH, decisions POST) can distinguish
    // "no boards" from "board not found" via selectedBoard instead of 500.
    return { generatedAt: Date.now(), selectedBoard: "", boards: [], agents: [], tasks: [], activity: [] };
  }
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

/** Events inserted after the given cursor (per board), newest first. */
export function activityDelta(fromCursor: string): ActivityEntry[] {
  const boards = discoverBoards();
  const from = new Map<string, number>();
  for (const part of fromCursor.split("|")) {
    const [slug, id] = part.split(":");
    from.set(slug, Number(id || 0));
  }
  const out: ActivityEntry[] = [];
  for (const board of boards) {
    const lastId = from.get(board.slug) ?? 0;
    try {
      const db = openReadOnly(board.dbPath);
      try {
        const rows = db.prepare(
          `SELECT e.id, e.kind, e.created_at, e.task_id, t.title, t.assignee
           FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id
           WHERE e.id > ? ORDER BY e.id DESC LIMIT 20`
        ).all(lastId) as AnyRow[];
        for (const r of rows) {
          out.push({
            id: Number(r.id), board: board.slug, kind: String(r.kind),
            taskId: String(r.task_id), taskTitle: String(r.title || ""),
            assignee: r.assignee == null ? null : String(r.assignee),
            createdAt: Number(r.created_at),
          });
        }
      } finally { db.close(); }
    } catch { /* skip board */ }
  }
  return out.sort((a, b) => b.id - a.id).slice(0, 20);
}
