// Client-side kanban delta application — keeps the board smooth without
// full snapshot reloads. Pure functions (no server deps), unit-tested.

export type TaskDelta = {
  id: string;
  status: string;
  assignee: string | null;
  board: string;
  lastHeartbeatAt: number | null;
};

export type TaskCardLike = {
  id: string;
  status: string;
  assignee: string | null;
  boardSlug?: string;
};

export type ActivityEntry = {
  id: number;
  board: string;
  kind: string;
  taskId: string;
  taskTitle: string;
  assignee: string | null;
  createdAt: number;
};

/**
 * Merge live deltas into the local task list in place.
 * - Only fields the kanban renders (status, assignee) are compared —
 *   lastHeartbeatAt is intentionally ignored (heartbeats fire every ~30s while
 *   an agent works; diffing them would re-render cards constantly).
 * - Returns the SAME array reference when nothing changed (no re-render).
 */
export function applyTaskDeltas<T extends TaskCardLike>(tasks: T[], deltas: TaskDelta[], activeBoardSlug?: string): T[] {
  if (!deltas.length) return tasks;
  let changed = false;
  const next = tasks.map((t) => {
    const d = deltas.find((x) => x.id === t.id);
    if (!d) return t;
    // Prevent cross-board pollution: if activeBoardSlug is set, ignore deltas for tasks on other boards
    const taskBoard = t.boardSlug || (t as unknown as { board?: string }).board || activeBoardSlug;
    if (activeBoardSlug && d.board !== activeBoardSlug && taskBoard !== activeBoardSlug) return t;

    if (d.status === t.status && d.assignee === t.assignee) return t;
    changed = true;
    return { ...t, status: d.status, assignee: d.assignee, boardSlug: d.board };
  });
  return changed ? next : tasks;
}


/** Prepend new activity entries, dedupe by id, cap the feed length. */
export function mergeActivity<T extends { id: number }>(prev: T[], incoming: T[], cap = 60): T[] {
  if (!incoming.length) return prev;
  const seen = new Set<number>(prev.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  if (!fresh.length) return prev;
  return [...fresh, ...prev].slice(0, cap);
}

/**
 * Kinds that represent real work — they move cards or add to the feed.
 * Pure `heartbeat` ticks only advance presence, never trigger a board update.
 * (Regression guard: heartbeats caused full reloads during work sessions.)
 */
export const WORK_KINDS = new Set([
  "completed", "blocked", "promoted", "created", "archived", "unblocked",
  "claimed", "spawned", "specified", "assigned", "dependency_wait",
  "block_loop_detected", "timed_out", "commented", "reopened",
]);

/** Classify a batch of new activity entries for the SSE emitter. */
export function classifyEvents(entries: { kind: string }[]): "work" | "presence" | "none" {
  if (!entries.length) return "none";
  return entries.some((e) => WORK_KINDS.has(e.kind)) ? "work" : "presence";
}
