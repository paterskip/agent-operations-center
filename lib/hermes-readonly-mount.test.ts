import Database from "better-sqlite3";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Regression test for the "board vanish" bug (QA t_4eff9db5).
//
// Symptom: on a read-only kanban mount, the WAL-mode board database cannot be
// opened read-only and the fallback in lib/hermes.ts `openReadOnly()` failed to
// recognise the SQLITE_CANTOPEN "unable to open database file" error. Because
// `safeReadTasks()`/`safeBoardSummary()` swallow any thrown error, the board
// silently dropped to 0 tasks ("vanished").
//
// This test:
//   1. builds a real WAL board with one checkpointed task plus a stale -wal
//      (a broker killed mid-write), and bind-mounts the board directory
//      READ-ONLY — a genuine read-only-mount simulation;
//   2. forces the exact production error signature (SQLITE_CANTOPEN /
//      "unable to open database file") on that path, because modern SQLite only
//      raises it when the main file is incomplete or a live writer holds the
//      wal-index (content/timing dependent), so it cannot be relied on to fire
//      deterministically from the mount alone;
//   3. asserts the board is still served with its checkpointed task (not 0).
//
// The test fails if the SQLITE_CANTOPEN branch in `openReadOnly()` is removed,
// so it is a genuine regression guard rather than a tautology.
// ---------------------------------------------------------------------------

// Mutable holder so the (hoisted) mock can throw for exactly the read-only
// board's path while delegating every other open to the real better-sqlite3.
const ctx = vi.hoisted(() => ({ roDbPath: "" }));

vi.mock("better-sqlite3", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual: any = await vi.importActual("better-sqlite3");
  const RealDatabase = actual.default as typeof Database;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: function Database(file: any, opts?: any) {
      if (typeof file === "string" && file === ctx.roDbPath) {
        // Exact production failure: WAL + read-only mount, -shm absent.
        const err = new Error("unable to open database file") as Error & { code: string };
        err.code = "SQLITE_CANTOPEN";
        throw err;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new (RealDatabase as any)(file, opts);
    },
  };
});

let root = "";
let kanbanRoot = "";
let srcBoardDir = "";
let mountPoint = "";
let mounted = false;

// Top-level setup (not beforeAll) so `describe.skipIf(!mounted)` can see the
// flag at collection time. Runs before the test definitions are collected.
try {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aoc-ro-mount-"));
  kanbanRoot = path.join(root, "kanban");
  const profilesRoot = path.join(root, "profiles");
  fs.mkdirSync(path.join(profilesRoot, "coder"), { recursive: true });
  fs.writeFileSync(path.join(profilesRoot, "coder", "profile.yaml"), "description: Test\n");

  // Build the WAL board DB in a writable src dir (mirrors the real schema used
  // by lib/hermes.ts). One task is checkpointed into the main file.
  srcBoardDir = path.join(root, "src-board");
  fs.mkdirSync(srcBoardDir, { recursive: true });
  const dbPath = path.join(srcBoardDir, "kanban.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(
    "CREATE TABLE tasks (id TEXT, title TEXT, body TEXT, assignee TEXT, status TEXT, priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, branch_name TEXT, result TEXT, block_kind TEXT, last_heartbeat_at INTEGER, model_override TEXT)",
  );
  db.exec("CREATE TABLE task_links (parent_id TEXT, child_id TEXT)");
  db.exec("CREATE TABLE task_comments (id INTEGER, task_id TEXT, author TEXT, body TEXT, created_at INTEGER)");
  db.exec("CREATE TABLE task_runs (id INTEGER, task_id TEXT, profile TEXT, status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER, summary TEXT, error TEXT)");
  db.exec("CREATE TABLE task_attachments (id INTEGER, task_id TEXT)");
  db.exec("CREATE TABLE task_events (id INTEGER, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER)");
  db.prepare(
    "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run("t1", "Task One", "Body", "coder", "running", 2, 1700000000, 1700000001, null, null, null, null, 1700000002, null);
  db.prepare("INSERT INTO task_events VALUES (?,?,?,?,?)").run(1, "t1", "created", "{}", 1700000001);
  db.pragma("wal_checkpoint(TRUNCATE)"); // t1 now lives in the main file
  // Snapshot the -wal before closing, then restore it afterwards to mimic a
  // broker killed mid-write (stale -wal, no -shm) on the read-only mount.
  const walBytes = fs.readFileSync(dbPath + "-wal");
  db.close();
  fs.writeFileSync(dbPath + "-wal", walBytes);

  // Bind-mount the board dir READ-ONLY at the path discoverBoards() scans.
  mountPoint = path.join(kanbanRoot, "boards", "app-ro");
  fs.mkdirSync(mountPoint, { recursive: true });
  execSync(`mount --bind ${srcBoardDir} ${mountPoint}`, { stdio: "pipe" });
  execSync(`mount -o remount,ro,bind ${mountPoint}`, { stdio: "pipe" });
  mounted = true;

  process.env.HERMES_KANBAN_ROOT = kanbanRoot;
  process.env.HERMES_PROFILES_ROOT = profilesRoot;
  process.env.AOC_AGENTS = "coder";
  ctx.roDbPath = path.join(mountPoint, "kanban.db");
  vi.resetModules();
} catch (err) {
  // No mount privileges (e.g. CI runner): leave `mounted` false so the suite
  // is skipped cleanly instead of failing.
  console.warn("[hermes-readonly-mount] skipping read-only mount setup:", (err as Error).message);
}

afterAll(() => {
  if (mounted) {
    try { execSync(`umount ${mountPoint}`, { stdio: "pipe" }); } catch { /* already unmounted */ }
  }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe.skipIf(!mounted)("read-only mount fallback (SQLITE_CANTOPEN)", () => {
  it("the read-only open of the mounted board fails with the production error", () => {
    expect(() => new Database(ctx.roDbPath, { readonly: true, fileMustExist: true })).toThrow(
      /unable to open database file/,
    );
    // The directory is genuinely read-only.
    expect(() => fs.writeFileSync(path.join(mountPoint, "probe"), "x")).toThrow();
  });

  it("getSnapshot serves the board with its checkpointed task instead of dropping it to 0", async () => {
    const { getSnapshot } = await import("../lib/hermes");
    const snap = getSnapshot();

    const board = snap.boards.find((b) => b.slug === "app-ro");
    expect(board).toBeDefined();
    const taskCount = Object.values(board!.counts).reduce<number>((sum, n) => sum + Number(n), 0);
    expect(taskCount).toBe(1);

    // The recovered board is also the selected one and actually yields its task.
    expect(snap.selectedBoard).toBe("app-ro");
    expect(snap.tasks.map((t) => t.id)).toContain("t1");
  });
});
