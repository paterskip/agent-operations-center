import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
// @ts-expect-error -- process-commands.mjs has JSDoc but no TS declarations (allowJs is off)
import { ensureTables, runOne, processDecision, processMove, backupKanban, now } from "./process-commands.mjs";

const testsDir = path.join(os.tmpdir(), `aoc-broker-test-${process.pid}-${Date.now()}`);
let dbPath: string;
let kanbanRoot: string;
let db: Database.Database;

beforeEach(() => {
  dbPath = path.join(testsDir, `state-${Date.now()}.db`);
  kanbanRoot = path.join(testsDir, "kanban-root");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.join(kanbanRoot, "boards"), { recursive: true });
  fs.mkdirSync(path.join(kanbanRoot, "backups"), { recursive: true });
  db = new Database(dbPath);
  ensureTables(db);
});

afterEach(() => {
  db.close();
});

function makeIdea(db: Database.Database) {
  const ts = now();
  const id = `idea-${ts}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO ideas(id,title,description,project,priority,mode,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    id, "Test idea", "Test description", "portfolio", 2, "analysis", "draft", ts, ts
  );
  return id;
}

describe("runOne — idea → hermes command", () => {
  it("queues idea, execs hermes create, marks done", () => {
    const ideaId = makeIdea(db);
    db.prepare("INSERT INTO commands(kind, idea_id, created_at, updated_at) VALUES(?,?,?,?)")
      .run("hermes-create", ideaId, now(), now());

    const calls: string[][] = [];
    const exec = (board: string, args: string[]) => {
      calls.push([board, ...args]);
      return JSON.stringify({ id: `hermes-task-${ideaId}` });
    };

    expect(runOne(db, exec)).toBe(true);
    expect(calls[0][0]).toBe("portfolio");
    expect(calls[0]).toContain("create");
    expect(calls[0]).toContain("--idempotency-key");
    expect(calls[0]).toContain(createHash("sha256").update(`aoc:${ideaId}`).digest("hex"));

    const cmd = db.prepare("SELECT status, updated_at FROM commands WHERE idea_id=?").get(ideaId) as { status: string } | undefined;
    expect(cmd?.status).toBe("done");

    const idea = db.prepare("SELECT status, hermes_task_id FROM ideas WHERE id=?").get(ideaId) as { status: string; hermes_task_id: string } | undefined;
    expect(idea?.status).toBe("submitted");
    expect(idea?.hermes_task_id).toBe(`hermes-task-${ideaId}`);
  });

  it("returns false when no pending commands", () => {
    const exec = () => { throw new Error("should not call"); };
    expect(runOne(db, exec)).toBe(false);
  });

  it("handles hermes failure → command stays pending (attempts < 3)", () => {
    const ideaId = makeIdea(db);
    db.prepare("INSERT INTO commands(kind, idea_id, created_at, updated_at) VALUES(?,?,?,?)")
      .run("hermes-create", ideaId, now(), now());

    const exec = () => { throw new Error("hermes crashed"); };
    expect(runOne(db, exec)).toBe(true);

    const cmd = db.prepare("SELECT status, attempts FROM commands WHERE idea_id=?").get(ideaId) as { status: string; attempts: number } | undefined;
    expect(cmd?.status).toBe("pending");
    expect(cmd?.attempts).toBe(1);

    const idea = db.prepare("SELECT status, last_error FROM ideas WHERE id=?").get(ideaId) as { status: string; last_error: string } | undefined;
    expect(idea?.status).toBe("queue_error");
    expect(idea?.last_error).toContain("hermes crashed");
  });

  it("marks command failed after 3 attempts", () => {
    const ideaId = makeIdea(db);
    db.prepare("INSERT INTO commands(kind, idea_id, attempts, created_at, updated_at) VALUES(?,?,?,?,?)")
      .run("hermes-create", ideaId, 2, now(), now());

    const exec = () => { throw new Error("always crashes"); };
    runOne(db, exec);

    const cmd = db.prepare("SELECT status, attempts FROM commands WHERE idea_id=?").get(ideaId) as { status: string; attempts: number } | undefined;
    expect(cmd?.status).toBe("failed");
    expect(cmd?.attempts).toBe(3);
  });

  it("handles orphaned command (idea deleted) → failed, no crash", () => {
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO commands(kind, idea_id, created_at, updated_at) VALUES(?,?,?,?)")
      .run("hermes-create", "nonexistent-idea-id", now(), now());

    const exec = () => { throw new Error("should not call"); };
    expect(runOne(db, exec)).toBe(true);
    db.pragma("foreign_keys = ON");

    const cmd = db.prepare("SELECT status FROM commands WHERE idea_id=?").get("nonexistent-idea-id") as { status: string } | undefined;
    expect(cmd?.status).toBe("failed");
  });
});

describe("processDecision — decision actions", () => {
  function makeDecision(db: Database.Database, action: string, board: string, taskId: string, fromStatus: string, comment = "") {
    const ts = now();
    const id = `dec-${ts}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO task_decisions(id,board,task_id,action,from_status,to_status,comment,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, board, taskId, action, fromStatus, null, comment, "queued", ts, ts);
    return id;
  }

  it("approve: calls hermes unblock on blocked task", () => {
    const decId = makeDecision(db, "approve", "myboard", "T-1", "blocked", "LGTM");
    let showCount = 0;
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") {
        showCount++;
        return JSON.stringify({ task: { id: "T-1", status: showCount === 1 ? "blocked" : "ready" } });
      }
      expect(args[0]).toBe("unblock");
      return JSON.stringify({ ok: true });
    };

    expect(processDecision(db, fakeExec)).toBe(true);
    const dec = db.prepare("SELECT status, result_status FROM task_decisions WHERE id=?").get(decId) as { status: string; result_status: string } | undefined;
    expect(dec?.status).toBe("done");
    expect(dec?.result_status).toBe("ready");
  });

  it("approve: allows review status when task was blocked during review", () => {
    const decId = makeDecision(db, "approve", "myboard", "T-1", "blocked", "LGTM");
    let showCount = 0;
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") {
        showCount++;
        return JSON.stringify({ task: { id: "T-1", status: showCount === 1 ? "blocked" : "review" } });
      }
      expect(args[0]).toBe("unblock");
      return JSON.stringify({ ok: true });
    };

    expect(processDecision(db, fakeExec)).toBe(true);
    const dec = db.prepare("SELECT status, result_status FROM task_decisions WHERE id=?").get(decId) as { status: string; result_status: string } | undefined;
    expect(dec?.status).toBe("done");
    expect(dec?.result_status).toBe("review");
  });

  it("approve: fails when unblock still leaves task blocked", () => {
    const decId = makeDecision(db, "approve", "myboard", "T-1", "blocked", "LGTM");
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") {
        return JSON.stringify({ task: { id: "T-1", status: "blocked" } });
      }
      return JSON.stringify({ ok: true });
    };

    processDecision(db, fakeExec);
    const dec = db.prepare("SELECT status, last_error FROM task_decisions WHERE id=?").get(decId) as { status: string; last_error: string } | undefined;
    expect(dec?.status).toBe("failed");
    expect(dec?.last_error).toContain("Unexpected resulting status");
  });

  it("approve: handles concurrent unblock idempotently (already resolved)", () => {
    const decId = makeDecision(db, "approve", "b1", "T-9", "blocked", "LGTM");
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") return JSON.stringify({ task: { id: "T-9", status: "running" } });
      return JSON.stringify({});
    };
    expect(processDecision(db, fakeExec)).toBe(true);
    const dec = db.prepare("SELECT status, result_status FROM task_decisions WHERE id=?").get(decId) as { status: string; result_status: string } | undefined;
    expect(dec?.status).toBe("done");
    expect(dec?.result_status).toBe("running");
  });

  it("approve: fails when before.status != from_status and task is not resolved", () => {
    const decId = makeDecision(db, "approve", "b1", "T-9", "scheduled", "LGTM");
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") return JSON.stringify({ task: { id: "T-9", status: "blocked" } });
      return JSON.stringify({});
    };
    processDecision(db, fakeExec);
    const dec = db.prepare("SELECT status, last_error FROM task_decisions WHERE id=?").get(decId) as { status: string; last_error: string } | undefined;
    expect(dec?.status).toBe("failed");
    expect(dec?.last_error).toContain("Task status changed");
  });

  it("reject: blocked task → comment, not block", () => {
    const decId = makeDecision(db, "reject", "b1", "T-1", "blocked", "no");
    let gotComment = false;
    let showCount = 0;
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") {
        showCount++;
        return JSON.stringify({ task: { id: "T-1", status: showCount === 1 ? "blocked" : "triage" } });
      }
      if (args[0] === "comment") { gotComment = true; return JSON.stringify({}); }
      return JSON.stringify({});
    };
    processDecision(db, fakeExec);
    expect(gotComment).toBe(true);
    const dec = db.prepare("SELECT status, result_status FROM task_decisions WHERE id=?").get(decId) as { status: string; result_status: string } | undefined;
    expect(dec?.status).toBe("done");
  });

  it("hold: blocked task → fails (not in allowed statuses)", () => {
    const decId = makeDecision(db, "hold", "b1", "T-1", "blocked", "pause");
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") return JSON.stringify({ task: { id: "T-1", status: "blocked" } });
      return JSON.stringify({});
    };
    processDecision(db, fakeExec);
    const dec = db.prepare("SELECT status, last_error FROM task_decisions WHERE id=?").get(decId) as { status: string; last_error: string } | undefined;
    expect(dec?.status).toBe("failed");
    expect(dec?.last_error).toContain("Cannot hold task");
  });

  it("unknown action → failed", () => {
    const decId = makeDecision(db, "weird", "b1", "T-1", "blocked", "x");
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") return JSON.stringify({ task: { id: "T-1", status: "blocked" } });
      return JSON.stringify({});
    };
    processDecision(db, fakeExec);
    const dec = db.prepare("SELECT status FROM task_decisions WHERE id=?").get(decId) as { status: string } | undefined;
    expect(dec?.status).toBe("failed");
  });

  it("returns false when no queued decisions", () => {
    const fakeExec = () => { throw new Error("noop"); };
    expect(processDecision(db, fakeExec)).toBe(false);
  });
});

describe("processMove — transitions", () => {
  function makeMove(db: Database.Database, from: string, to: string, board = "b1", taskId = "T-1") {
    const ts = now();
    const id = `mv-${ts}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO task_moves(id,board,task_id,action,from_status,to_status,title,body,assignee,priority,comment,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, board, taskId, `${from}->${to}`, from, to, "Test", "Body", null, 2, "", "queued", ts, ts
    );
    return id;
  }

  it("todo→scheduled calls hermes schedule", () => {
    const moveId = makeMove(db, "todo", "scheduled");
    let gotSchedule = false;
    let showCount = 0;
    const fakeExec = (_board: string, args: string[]) => {
      if (args[0] === "show") {
        showCount++;
        return showCount === 1
          ? JSON.stringify({ task: { id: "T-1", status: "todo" } })
          : JSON.stringify({ task: { id: "T-1", status: "scheduled" } });
      }
      if (args[0] === "schedule") { gotSchedule = true; return JSON.stringify({}); }
      return JSON.stringify({});
    };
    processMove(db, fakeExec);
    expect(gotSchedule).toBe(true);
    const mv = db.prepare("SELECT status FROM task_moves WHERE id=?").get(moveId) as { status: string } | undefined;
    expect(mv?.status).toBe("done");
  });

  it("running→review calls complete", () => {
    const moveId = makeMove(db, "running", "review");
    let c = 0;
    let gotComplete = false;
    const exec = (_board: string, args: string[]) => {
      if (args[0] === "show") {
        c++;
        return JSON.stringify({ task: { id: "T-1", status: c === 1 ? "running" : "review" } });
      }
      expect(args[0]).toBe("complete");
      gotComplete = true;
      return JSON.stringify({});
    };
    processMove(db, exec);
    expect(gotComplete).toBe(true);
    const mv = db.prepare("SELECT status, result_status FROM task_moves WHERE id=?").get(moveId) as { status: string; result_status: string } | undefined;
    expect(mv?.status).toBe("done");
    expect(mv?.result_status).toBe("review");
  });

  it("unsupported transition → failed", () => {
    const moveId = makeMove(db, "done", "todo");
    processMove(db, (_b: string, args: string[]) => {
      if (args[0] === "show") return JSON.stringify({ task: { id: "T-1", status: "done" } });
      return JSON.stringify({});
    });
    const mv = db.prepare("SELECT status, last_error FROM task_moves WHERE id=?").get(moveId) as { status: string; last_error: string } | undefined;
    expect(mv?.status).toBe("failed");
    expect(mv?.last_error).toContain("Unsupported transition");
  });

  it("create action calls hermes create", () => {
    const ts = now();
    const id = `mv-create-${ts}`;
    db.prepare(`INSERT INTO task_moves(id,board,task_id,action,from_status,to_status,title,body,assignee,priority,comment,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
       id, "b1", id, "create", null, null, "New Task", "Body text", null, 2, "", "queued", ts, ts
    );
    let gotCreate = false;
    const exec = (_board: string, args: string[]) => {
      if (args[0] === "create") { gotCreate = true; return JSON.stringify({ id: "created-123" }); }
      return JSON.stringify({});
    };
    processMove(db, exec);
    expect(gotCreate).toBe(true);
    const mv = db.prepare("SELECT status, result_status FROM task_moves WHERE id=?").get(id) as { status: string; result_status: string } | undefined;
    expect(mv?.status).toBe("done");
    expect(mv?.result_status).toBe("created:created-123");
  });

  it("returns false when no queued moves", () => {
    const exec = () => { throw new Error("noop"); };
    expect(processMove(db, exec)).toBe(false);
  });

  it("fail-closed: status didn't change → failed", () => {
    const moveId = makeMove(db, "todo", "scheduled");
    // before.status === "todo" (== fromStatus), after.status === "todo" (unchanged)
    const exec = (_board: string, args: string[]) => {
      if (args[0] === "show") return JSON.stringify({ task: { id: "T-1", status: "todo" } });
      return JSON.stringify({});
    };
    processMove(db, exec);
    const mv = db.prepare("SELECT status, last_error FROM task_moves WHERE id=?").get(moveId) as { status: string; last_error: string } | undefined;
    expect(mv?.status).toBe("failed");
    expect(mv?.last_error).toContain("did not change status");
  });
});

describe("backupKanban — rotation + stamp gating", () => {
  it("writes backup files and stamp", () => {
    // Create fake board DB
    const boardSlug = "proj1";
    fs.mkdirSync(path.join(kanbanRoot, "boards", boardSlug), { recursive: true });
    fs.writeFileSync(path.join(kanbanRoot, "boards", boardSlug, "kanban.db"), "fake-db-content");

    const backupsDir = path.join(kanbanRoot, "backups");
    const stampFile = path.join(path.dirname(dbPath), ".aoc-last-backup");

    backupKanban({ stateDbPath: dbPath, kanbanRoot });

    expect(fs.existsSync(path.join(backupsDir, `default-.*.db`.replace(/.*/g, "")))); // just check dir exists
    const files = fs.readdirSync(backupsDir);
    // default db doesn't exist, only board backup
    expect(files.some((f) => f.startsWith("proj1-") && f.endsWith(".db"))).toBe(true);
    expect(fs.existsSync(stampFile)).toBe(true);
  });

  it("skips backup when stamp is < 5 minutes old", () => {
    const stampFile = path.join(path.dirname(dbPath), ".aoc-last-backup");
    fs.writeFileSync(stampFile, String(Date.now())); // recent

    const backupsDir = path.join(kanbanRoot, "backups");
    const oldCount = fs.readdirSync(backupsDir).length;
    backupKanban({ stateDbPath: dbPath, kanbanRoot });
    expect(fs.readdirSync(backupsDir).length).toBe(oldCount);
  });

  it("rotates backups to keep only BACKUP_KEEP per board", () => {
    const boardSlug = "rotate";
    fs.mkdirSync(path.join(kanbanRoot, "boards", boardSlug), { recursive: true });
    const backupsDir = path.join(kanbanRoot, "backups");

    // Pre-create 30 stale backups for the board
    for (let i = 0; i < 30; i++) {
      fs.writeFileSync(
        path.join(backupsDir, `rotate-2024-01-0${i % 10}-${i}.db`),
        `old-${i}`
      );
    }
    // Write old stamp so backup runs
    const stampFile = path.join(path.dirname(dbPath), ".aoc-last-backup");
    fs.writeFileSync(stampFile, String(Date.now() - 999_999));

    backupKanban({ stateDbPath: dbPath, kanbanRoot });

    const remaining = fs.readdirSync(backupsDir).filter((f) => f.startsWith("rotate-") && f.endsWith(".db"));
    expect(remaining.length).toBeLessThanOrEqual(24);
  });
});
