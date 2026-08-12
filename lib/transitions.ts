// Single source of truth for Kanban status transitions.
// Used by: the Kanban DnD UI (components/dashboard.tsx), the move API
// (app/api/tasks/route.ts) and the command broker (scripts/process-commands.mjs).
// The broker executes these transitions with `hermes kanban` CLI commands;
// anything not listed here cannot be executed end-to-end.

export const ALLOWED_DROPS: Record<string, readonly string[]> = {
  triage: ["todo"], // start triage → backlog
  todo: ["scheduled"], // schedule
  scheduled: ["todo", "ready"], // deschedule / promote to ready
  ready: ["todo", "running"], // move back / start
  running: ["blocked", "review"], // block for input / complete
  blocked: [], // CEO unblocks via decisions, never via DnD
  review: ["done"], // accept review
  done: ["todo"], // reopen
};

export function isAllowedMove(from: string, to: string): boolean {
  if (from === to) return false;
  return (ALLOWED_DROPS[from] || []).includes(to);
}
