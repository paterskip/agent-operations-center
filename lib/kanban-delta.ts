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
export function applyTaskDeltas<T extends TaskCardLike>(tasks: T[], deltas: TaskDelta[]): T[] {
  if (!deltas.length) return tasks;
  let changed = false;
  const next = tasks.map((t) => {
    const d = deltas.find((x) => x.id === t.id);
    if (!d) return t;
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
