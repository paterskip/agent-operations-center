import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Regression guard for the `board.create` command path.
 *
 * The board payload used to be stored in `commands.idea_id`, a column carrying
 * `FOREIGN KEY(idea_id) REFERENCES ideas(id)`. A project creation has no
 * matching row in `ideas`, so with `foreign_keys = ON` the insert failed with
 * FOREIGN KEY constraint failed and the CEO panel's "Nowy projekt" returned
 * 500 every time. The payload now lives in its own `commands.payload` column
 * and `idea_id` is nullable.
 *
 * These tests drive the real schema so the constraint cannot regress silently.
 */

let tmpDir = "";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, project TEXT NOT NULL,
    priority INTEGER NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
    hermes_task_id TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, idea_id TEXT,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY(idea_id) REFERENCES ideas(id)
  );
`;

function openDb() {
  const db = new Database(path.join(tmpDir, "aoc.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-fk-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("commands payload vs idea_id", () => {
  it("accepts a board.create payload that has no matching ideas row", () => {
    const db = openDb();
    const payload = JSON.stringify({ slug: "super-aplikacja", name: "Super Aplikacja" });

    expect(() => {
      db.prepare(
        "INSERT INTO commands(kind, payload, status, attempts, created_at, updated_at) VALUES('board.create', ?, 'pending', 0, 1, 1)"
      ).run(payload);
    }).not.toThrow();

    const row = db.prepare("SELECT kind, payload FROM commands").get() as { kind: string; payload: string };
    expect(row.kind).toBe("board.create");
    expect(JSON.parse(row.payload).slug).toBe("super-aplikacja");
    db.close();
  });

  it("still rejects an idea_id that references a non-existent idea", () => {
    const db = openDb();
    expect(() => {
      db.prepare(
        "INSERT INTO commands(kind, idea_id, status, attempts, created_at, updated_at) VALUES('create_analysis', ?, 'pending', 0, 1, 1)"
      ).run("idea_missing");
    }).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });

  it("accepts create_analysis for an existing idea", () => {
    const db = openDb();
    db.prepare(
      "INSERT INTO ideas(id,title,description,project,priority,mode,status,created_at,updated_at) VALUES('idea_1','t','d','p',2,'analysis','queued',1,1)"
    ).run();
    expect(() => {
      db.prepare(
        "INSERT INTO commands(kind, idea_id, status, attempts, created_at, updated_at) VALUES('create_analysis', ?, 'pending', 0, 1, 1)"
      ).run("idea_1");
    }).not.toThrow();
    db.close();
  });
});

describe("migration from the pre-payload schema", () => {
  // The schema that shipped before the fix: payload sharing NOT NULL idea_id.
  const LEGACY_SCHEMA = `
    CREATE TABLE ideas (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, project TEXT NOT NULL,
      priority INTEGER NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
      hermes_task_id TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, idea_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY(idea_id) REFERENCES ideas(id)
    );
  `;

  it("keeps a queued board.create and lets the broker read it from payload", async () => {
    process.env.AOC_STATE_DB = path.join(tmpDir, "legacy.db");
    const legacy = new Database(path.join(tmpDir, "legacy.db"));
    legacy.pragma("journal_mode = WAL");
    legacy.exec(LEGACY_SCHEMA);
    legacy.prepare("INSERT INTO ideas(id,title,description,project,priority,mode,status,created_at,updated_at) VALUES('idea_1','t','d','p',2,'analysis','queued',1,1)").run();
    const boardPayload = JSON.stringify({ slug: "stary-projekt", name: "Stary Projekt" });
    legacy.prepare("INSERT INTO commands(kind, idea_id, status, created_at, updated_at) VALUES('create_analysis','idea_1','done',1,1)").run();
    // Pre-fix, board.create payloads were written into idea_id. Note we must
    // disable foreign_keys to stage this row at all — which is itself the bug:
    // with the FK enforced the insert could never succeed.
    legacy.pragma("foreign_keys = OFF");
    legacy.prepare("INSERT INTO commands(kind, idea_id, status, created_at, updated_at) VALUES('board.create', ?,'pending',1,1)").run(boardPayload);
    legacy.pragma("foreign_keys = ON");
    legacy.close();

    vi.resetModules();
    const { enqueueProjectCreate } = await import("./state");
    // Opening the state DB triggers openState() and therefore the migration.
    enqueueProjectCreate({ slug: "nowy-projekt", name: "Nowy Projekt" });
    delete process.env.AOC_STATE_DB;

    const migrated = new Database(path.join(tmpDir, "legacy.db"), { readonly: true });
    const rows = migrated.prepare("SELECT kind, idea_id, payload FROM commands ORDER BY id").all() as
      Array<{ kind: string; idea_id: string | null; payload: string | null }>;

    // The old idea-backed command kept its idea_id and has no payload.
    const analysis = rows.find((r) => r.kind === "create_analysis")!;
    expect(analysis.idea_id).toBe("idea_1");
    expect(analysis.payload).toBeNull();

    // The old board.create payload moved to the payload column.
    const oldBoard = rows.find((r) => r.kind === "board.create")!;
    expect(oldBoard.idea_id).toBeNull();
    expect(JSON.parse(oldBoard.payload!).slug).toBe("stary-projekt");
    migrated.close();
  });
});
