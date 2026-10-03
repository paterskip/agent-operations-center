import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSchema, SCHEMA_VERSION } from "./state-schema.mjs";

/**
 * Regression guard for the AOC broker crash of 2026-09-30:
 * `SqliteError: no such column: payload`.
 *
 * The live DB still had the legacy `commands` shape (`idea_id TEXT NOT NULL`,
 * no `payload`). `CREATE TABLE IF NOT EXISTS` does not alter an existing table,
 * so merely adding `payload` to the DDL never reached old databases. The shared
 * `ensureSchema()` must migrate them in place, idempotently.
 */

let tmpDir = "";

/** Build a DB with the LEGACY schema (payload stored in the FK column). */
function openLegacyDb() {
  const db = new Database(path.join(tmpDir, "legacy.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
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
  `);
  return db;
}

function commandColumns(db: Database.Database) {
  return db.prepare("PRAGMA table_info(commands)").all() as { name: string; notnull: number }[];
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-schema-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureSchema — legacy migration", () => {
  it("adds payload, makes idea_id nullable, preserves idea-linked rows", () => {
    const db = openLegacyDb();
    db.prepare("INSERT INTO ideas VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      "idea_abc", "T", "D", "portfolio", 2, "analysis", "draft", null, null, 1, 1
    );
    db.prepare("INSERT INTO commands(kind,idea_id,status,attempts,created_at,updated_at) VALUES('create_analysis','idea_abc','done',1,1,1)").run();

    const noPayload = commandColumns(db).some((c) => c.name === "payload");
    expect(noPayload).toBe(false);

    ensureSchema(db);

    const cols = commandColumns(db);
    expect(cols.some((c) => c.name === "payload")).toBe(true);
    const ideaCol = cols.find((c) => c.name === "idea_id");
    expect(ideaCol?.notnull).toBe(0);

    // Existing idea-linked row survives with its idea_id intact.
    const row = db.prepare("SELECT kind, idea_id, payload FROM commands").get() as {
      kind: string; idea_id: string | null; payload: string | null;
    };
    expect(row.kind).toBe("create_analysis");
    expect(row.idea_id).toBe("idea_abc");
    expect(row.payload).toBeNull();

    db.close();
  });

  it("moves a legacy board payload (non-idea idea_id) into the payload column", () => {
    const db = openLegacyDb();
    const payload = JSON.stringify({ slug: "super-aplikacja", name: "Super Aplikacja" });
    // In the legacy shape a board.create payload was crammed into idea_id.
    db.prepare("PRAGMA foreign_keys = OFF").run();
    db.prepare("INSERT INTO commands(kind,idea_id,status,attempts,created_at,updated_at) VALUES('board.create',?,'pending',0,1,1)").run(payload);

    ensureSchema(db);

    const row = db.prepare("SELECT idea_id, payload FROM commands").get() as {
      idea_id: string | null; payload: string | null;
    };
    expect(row.idea_id).toBeNull();
    expect(row.payload).toBe(payload);

    db.close();
  });

  it("then accepts a board.create insert with no matching ideas row (the original 500)", () => {
    const db = openLegacyDb();
    ensureSchema(db);
    const payload = JSON.stringify({ slug: "nowy-projekt", name: "Nowy Projekt" });
    expect(() =>
      db.prepare("INSERT INTO commands(kind,payload,status,attempts,created_at,updated_at) VALUES('board.create',?,'pending',0,1,1)").run(payload)
    ).not.toThrow();
    // The broker's SELECT must now succeed.
    expect(db.prepare("SELECT id,kind,idea_id ideaId,payload FROM commands WHERE status='pending' AND attempts < 3").all().length).toBe(1);
    db.close();
  });

  it("is idempotent and stamps user_version", () => {
    const db = openLegacyDb();
    ensureSchema(db);
    const afterFirst = commandColumns(db).map((c) => c.name).join(",");
    ensureSchema(db); // second run must not throw ("duplicate column")
    expect(commandColumns(db).map((c) => c.name).join(",")).toBe(afterFirst);
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    db.close();
  });

  it("refuses a DB whose user_version is newer than this build", () => {
    const db = openLegacyDb();
    db.pragma(`user_version = ${SCHEMA_VERSION + 5}`);
    expect(() => ensureSchema(db)).toThrow(/newer than this build/);
    db.close();
  });
});
