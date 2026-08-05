import { describe, expect, it } from "vitest";
import { discoverBoards, getSnapshot } from "./hermes";

describe("Hermes read-only adapter", () => {
  it("discovers the configured boards", () => {
    const slugs = discoverBoards().map((board) => board.slug);
    expect(slugs).toContain("portfolio");
    expect(slugs).toContain("typer-bot");
  });

  it("returns a sanitized snapshot", () => {
    const snapshot = getSnapshot("typer-bot");
    expect(snapshot.selectedBoard).toBe("typer-bot");
    expect(snapshot.agents.map((agent) => agent.name)).toContain("coder");
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["workspace_path", "stored_path", "worker_pid", "claim_lock", "session_id", "kanban_notify_subs"]) expect(serialized).not.toContain(forbidden);
  });
});
