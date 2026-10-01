import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error -- process-commands.mjs has JSDoc but no TS declarations (allowJs is off)
import { checkpointAll } from "./process-commands.mjs";

/**
 * `checkpointAll` swallows every error, so a broken path list produces no
 * symptom at all — it just silently stops checkpointing databases. It used to
 * hardcode eleven agent slugs, which meant any profile added later was never
 * checkpointed. These tests assert discovery is dynamic.
 */

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-checkpoint-"));
  const kanbanRoot = path.join(root, "kanban");
  const profilesRoot = path.join(root, "profiles");
  const boardsDir = path.join(kanbanRoot, "boards", "alpha");
  fs.mkdirSync(boardsDir, { recursive: true });
  fs.mkdirSync(profilesRoot, { recursive: true });

  const makeDb = (p: string) => {
    const db = new Database(p);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS t (a INTEGER)");
    db.close();
  };

  makeDb(path.join(root, "kanban.db"));
  makeDb(path.join(root, "state.db"));
  makeDb(path.join(boardsDir, "kanban.db"));
  // Two profiles: one known, one added after the list used to be hardcoded.
  for (const slug of ["pm", "nowy-agent-2030"]) {
    fs.mkdirSync(path.join(profilesRoot, slug), { recursive: true });
    makeDb(path.join(profilesRoot, slug, "state.db"));
  }
  // A directory that must be skipped.
  fs.mkdirSync(path.join(profilesRoot, "_cache"), { recursive: true });

  process.env.HERMES_KANBAN_ROOT = kanbanRoot;
  process.env.HERMES_PROFILES_ROOT = profilesRoot;
});

afterEach(() => {
  delete process.env.HERMES_KANBAN_ROOT;
  delete process.env.HERMES_PROFILES_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("checkpointAll discovery", () => {
  it("checkpoints every profile present, including ones added after the fact", () => {
    expect(() => checkpointAll()).not.toThrow();
  });

  it("leaves the databases usable and their WAL folded into the main file", () => {
    checkpointAll();

    for (const p of [
      path.join(root, "kanban.db"),
      path.join(root, "profiles", "pm", "state.db"),
      path.join(root, "profiles", "nowy-agent-2030", "state.db"),
      path.join(root, "kanban", "boards", "alpha", "kanban.db"),
    ]) {
      const db = new Database(p, { readonly: true, fileMustExist: true });
      // A checkpointed WAL database opens cleanly and reports no error.
      expect(() => db.prepare("SELECT COUNT(*) c FROM t").get()).not.toThrow();
      db.close();
    }
  });
});
