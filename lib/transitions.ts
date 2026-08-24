// Single source of truth for Kanban status transitions.
// Used by: the Kanban DnD UI (components/dashboard.tsx), the move API
// (app/api/tasks/route.ts) and the command broker (scripts/process-commands.mjs).
//
// Most transitions are transitions that the `hermes kanban` CLI can EXECUTE
// natively. The one exception is done→todo ('reopen'), which the CLI cannot
// perform — the broker executes it over HTTP against the hermes dashboard
// kanban plugin API (PATCH /tasks/{id}?board=<b> with {"status":"todo"}),
// authenticated with the dashboard session token. Everything else
// (triage→todo via `specify`, scheduled→ready via recompute_ready, review→done
// by the reviewer agent, etc.) is agent-driven by design — the CEO panel never
// fakes a move that the CLI cannot perform (a `comment` alone does NOT change
// task status; verified 2026-08-12).

export const ALLOWED_DROPS: Record<string, string[]> = {
  triage: [], // agents specify/decompose triage tasks
  todo: ["scheduled"], // `hermes kanban schedule`
  scheduled: [], // leaves via agent auto-promotion (recompute_ready)
  ready: ["running"], // `hermes kanban claim`
  running: ["blocked", "review"], // `block` / `complete`
  blocked: [], // CEO unblocks via decisions (`unblock`)
  review: ["ready"], // `hermes kanban reopen-review` (send back for rework)
  done: ["todo"], // 'reopen' via hermes dashboard kanban plugin API (PATCH /tasks/{id})
};

export function isAllowedMove(from: string, to: string): boolean {
  if (from === to) return false;
  return (ALLOWED_DROPS[from] || []).includes(to);
}
