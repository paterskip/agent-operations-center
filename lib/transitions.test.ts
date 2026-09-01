import { describe, expect, it } from "vitest";
import { ALLOWED_DROPS, isAllowedMove } from "./transitions";

describe("Kanban transition table", () => {
  it("allows the native CLI transitions", () => {
    expect(isAllowedMove("todo", "scheduled")).toBe(true); // schedule
    expect(isAllowedMove("ready", "running")).toBe(true); // claim
    expect(isAllowedMove("running", "blocked")).toBe(true); // block
    expect(isAllowedMove("running", "review")).toBe(true); // complete
    expect(isAllowedMove("review", "ready")).toBe(true); // reopen-review
  });

  it("allows done→todo reopen (broker executes it over the dashboard plugin API HTTP transport)", () => {
    expect(isAllowedMove("done", "todo")).toBe(true); // HTTP reopen, not CLI
  });

  it("rejects transitions nothing can execute", () => {
    // comment-based moves do NOT change status (verified 2026-08-12)
    expect(isAllowedMove("triage", "todo")).toBe(false); // specify needs aux LLM
    expect(isAllowedMove("scheduled", "todo")).toBe(false);
    expect(isAllowedMove("scheduled", "ready")).toBe(false); // promote: todo|blocked only
    expect(isAllowedMove("ready", "todo")).toBe(false);
    expect(isAllowedMove("review", "done")).toBe(false);
    expect(isAllowedMove("done", "review")).toBe(false); // only done→todo is reopenable
    expect(isAllowedMove("done", "ready")).toBe(false);
    expect(isAllowedMove("blocked", "ready")).toBe(false); // decisions only (unblock)
    expect(isAllowedMove("blocked", "review")).toBe(false);
  });

  it("never allows self-moves or unknown statuses", () => {
    for (const status of ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"]) {
      expect(isAllowedMove(status, status)).toBe(false);
      expect(isAllowedMove(status, "bogus")).toBe(false);
    }
    expect(isAllowedMove("bogus", "todo")).toBe(false);
  });

  it("keeps every allowed target in the canonical STATUSES list", () => {
    const statuses = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"];
    for (const [from, targets] of Object.entries(ALLOWED_DROPS)) {
      expect(statuses).toContain(from);
      for (const target of targets) expect(statuses).toContain(target);
    }
  });
});
