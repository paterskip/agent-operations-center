#!/usr/bin/env node
// Executive Digest — daily/weekly CEO report (single-purpose data collector).
// Reads Hermes Kanban boards + AOC state DB; prints a Telegram-ready digest.
// Usage: node executive-digest.mjs [--weekly]
// Env: HERMES_KANBAN_ROOT, HERMES_PROFILES_ROOT, AOC_STATE_DB, AOC_AGENTS

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const KANBAN_ROOT = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";
const PROFILES_ROOT = process.env.HERMES_PROFILES_ROOT || "/root/.hermes/profiles";
const STATE_DB = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";
const DEFAULT_AGENTS = "pm,coder,coder-parallel,designer,tester,reviewer";
const NAME_FALLBACK = { default: "Default Agent" };
const HOUR = 3600;
const DAY = 24 * HOUR;
const WEEKLY = process.argv.includes("--weekly");

function agentName(slug) {
  try {
    const p = path.join(PROFILES_ROOT, slug, "profile.yaml");
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, "utf8").match(/^name:\s*(.+)$/m);
      if (m && m[1].trim()) return m[1].trim();
    }
  } catch { /* fall through */ }
  return NAME_FALLBACK[slug] || slug;
}

function listBoards() {
  const dir = path.join(KANBAN_ROOT, "boards");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((slug) =>
    !slug.startsWith("_") && !slug.includes("..") &&
    fs.existsSync(path.join(dir, slug, "kanban.db"))
  ).sort();
}

function openRO(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

function collect() {
  const now = Math.floor(Date.now() / 1000);
  const agents = new Map();
  const decisions = [];
  const blocked = [];
  const running = [];
  const reworked = new Map(); // taskId -> completed count in window (rework proxy)

  for (const board of listBoards()) {
    let db;
    try {
      db = openRO(path.join(KANBAN_ROOT, "boards", board, "kanban.db"));
      const tasks = db.prepare("SELECT id,title,assignee,status,created_at,started_at,block_kind FROM tasks WHERE status != 'archived'").all();
      const events = db.prepare("SELECT task_id, kind, created_at FROM task_events").all();

      for (const t of tasks) {
        const slug = t.assignee ? String(t.assignee) : null;
        const ageRef = Number(t.started_at || t.created_at || now);
        if (slug) {
          const a = agents.get(slug) || { slug, done7: 0, done1: 0, blocked7: 0, blocked1: 0, created7: 0, running: 0, total: 0 };
          a.total++;
          if (t.status === "running") a.running++;
          agents.set(slug, a);
        }
        if (t.status === "blocked") blocked.push({ board, id: String(t.id), title: String(t.title), age: now - ageRef, needsInput: t.block_kind === "needs_input" });
        if (t.status === "blocked" && t.block_kind === "needs_input") decisions.push({ board, id: String(t.id), title: String(t.title), age: now - ageRef });
        if (t.status === "running") running.push({ board, id: String(t.id), title: String(t.title) });
      }

      for (const e of events) {
        const tid = String(e.task_id);
        const age = now - Number(e.created_at);
        const inWindow = WEEKLY ? age < 7 * DAY : age < DAY;
        if (e.kind === "completed") {
          const c = reworked.get(tid) || 0;
          reworked.set(tid, c + 1);
        }
        if (!inWindow) continue;
        // assignee via task lookup (events don't carry it)
        const task = tasks.find((t) => t.id === tid);
        if (!task || !task.assignee) continue;
        const a = agents.get(String(task.assignee)) || { slug: String(task.assignee), done7: 0, done1: 0, blocked7: 0, blocked1: 0, created7: 0, running: 0, total: 0 };
        if (e.kind === "completed") { a.done7++; if (age < DAY) a.done1++; }
        if (e.kind === "blocked") { a.blocked7++; if (age < DAY) a.blocked1++; }
        if (e.kind === "created") a.created7++;
        agents.set(String(task.assignee), a);
      }
    } catch (err) {
      process.stderr.write(`digest: ${board}: ${err.message}\n`);
    } finally {
      if (db) db.close();
    }
  }

  decisions.sort((a, b) => b.age - a.age);
  return { agents, decisions, blocked, running, reworked };
}

function queueStatus() {
  try {
    if (!fs.existsSync(STATE_DB)) return null;
    const db = openRO(STATE_DB);
    try {
      const q = db.prepare("SELECT status, COUNT(*) c FROM task_moves WHERE status IN ('queued','running') GROUP BY status").all();
      const c = db.prepare("SELECT COUNT(*) c FROM commands WHERE status='pending'").get();
      const d = db.prepare("SELECT COUNT(*) c FROM task_decisions WHERE status='queued'").get();
      const total = (q.find((r) => r.status === "queued")?.c || 0) + (q.find((r) => r.status === "running")?.c || 0) + Number(c.c) + Number(d.c);
      return total;
    } finally { db.close(); }
  } catch { return null; }
}

function fmtAge(hours) {
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function buildText({ agents, decisions, blocked, running, reworked }) {
  const now = new Date();
  const date = now.toLocaleDateString("pl-PL");
  const time = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const window = WEEKLY ? "7 dni" : "24h";
  const queue = queueStatus();
  const lines = [];

  lines.push(WEEKLY ? `📈 Executive Digest (tydzień) — ${date}` : `📊 Executive Digest — ${date}`);
  lines.push(`${agents.size} agentów · ${listBoards().length} boardy · okno: ${window}`);
  lines.push("─".repeat(40));

  const sorted = [...agents.values()].sort((a, b) => (b.done7 + b.done1) - (a.done7 + a.done1));
  if (WEEKLY) {
    lines.push("👥 Agenci — 7 dni:");
    for (const a of sorted) {
      lines.push(`• ${agentName(a.slug)} — ${a.done7} done · ${a.blocked7} blocked · ${a.created7} created · ${a.running} w toku`);
    }
    const multi = [...reworked.values()].filter((n) => n > 1).length;
    if (multi) lines.push(`♻️ Ponownie ukończone (rework): ${multi} zadań`);
  } else {
    lines.push("👥 Agenci — ostatnie 24h:");
    const active = sorted.filter((a) => a.done1 || a.blocked1 || a.created7);
    if (!active.length) lines.push("• Brak aktywności w ostatnich 24h");
    for (const a of active) {
      lines.push(`• ${agentName(a.slug)} — ${a.done1} done · ${a.blocked1} blocked · ${a.running} w toku`);
    }
  }
  lines.push("");

  if (decisions.length) {
    lines.push(`⚠️ Decyzje CEO: ${decisions.length} (najstarsza ${fmtAge(Math.floor(decisions[0].age / HOUR))})`);
    for (const d of decisions.slice(0, WEEKLY ? 10 : 5)) {
      lines.push(`• ${d.title.slice(0, 80)} — ${d.board} · ${fmtAge(Math.floor(d.age / HOUR))}`);
    }
    if (decisions.length > 5 && !WEEKLY) lines.push(`• … i ${decisions.length - 5} więcej (pełna lista w panelu)`);
    lines.push("");
  }

  lines.push(`🚧 Zablokowane: ${blocked.length} · ⏳ W toku: ${running.length}`);
  if (queue != null) lines.push(`📥 Kolejka brokera: ${queue}`);
  lines.push("");
  lines.push(`Źródło: AOC · ${time}`);

  return lines.join("\n");
}

function main() {
  const data = collect();
  const text = buildText(data);
  process.stdout.write(text + "\n");
}

main();
