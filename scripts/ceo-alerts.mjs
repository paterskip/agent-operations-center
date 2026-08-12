#!/usr/bin/env node
// AOC CEO Alerts — proactive watchdogs (single-purpose data collector).
// Prints alerts to stdout; EMPTY stdout = nothing to report (silent run).
// Cron: every 30 min, no_agent mode (empty output = no message).
// Env: HERMES_KANBAN_ROOT, AOC_STATE_DB

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const KANBAN_ROOT = process.env.HERMES_KANBAN_ROOT || "/root/.hermes/kanban";
const STATE_DB = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";
const HOUR = 3600;
const MINUTE = 60;

// ── thresholds ──
const BLOCKED_AFTER_H = 24;        // task blocked longer than this → alert
const DECISION_SLA_H = 48;         // needs_input waiting longer → decision overdue
const READY_STALE_H = 24;          // ready task unclaimed longer → alert
const HEARTBEAT_STALE_MIN = 30;    // running task without heartbeat → stuck
const QUEUE_STALE_MIN = 15;        // broker queue item stuck longer → alert

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

function fmtAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}

function collectAlerts() {
  const now = Math.floor(Date.now() / 1000);
  const alerts = [];

  for (const board of listBoards()) {
    let db;
    try {
      db = openRO(path.join(KANBAN_ROOT, "boards", board, "kanban.db"));
      const tasks = db.prepare(
        "SELECT id,title,assignee,status,created_at,started_at,last_heartbeat_at,claim_expires,block_kind FROM tasks WHERE status != 'archived'"
      ).all();

      for (const t of tasks) {
        const status = String(t.status);
        const ageRef = Number(t.started_at || t.created_at || now);
        const ageH = (now - ageRef) / HOUR;

        if (status === "blocked" && ageH > BLOCKED_AFTER_H) {
          const needsInput = t.block_kind === "needs_input";
          const title = String(t.title).slice(0, 70);
          if (needsInput && ageH > DECISION_SLA_H) {
            alerts.push(`🔴 SLA decyzji przekroczone (${fmtAge(ageH)}): ${title} [${board}]`);
          } else if (needsInput) {
            alerts.push(`⚠️ decyzja od ${fmtAge(ageH)}: ${title} [${board}]`);
          } else {
            alerts.push(`⚠️ blokada od ${fmtAge(ageH)}: ${title} [${board}]`);
          }
        }

        if (status === "ready" && ageH > READY_STALE_H) {
          alerts.push(`🟡 ready od ${fmtAge(ageH)}, nikt nie claimuje: ${String(t.title).slice(0, 70)} [${board}]`);
        }

        if (status === "running") {
          const hb = t.last_heartbeat_at == null ? null : Number(t.last_heartbeat_at);
          if (hb == null || now - hb > HEARTBEAT_STALE_MIN * MINUTE) {
            alerts.push(`🩸 stuck running (heartbeat ${hb == null ? "brak" : fmtAge((now - hb) / HOUR)}): ${String(t.title).slice(0, 70)} [${board}]`);
          }
          const expires = t.claim_expires == null ? null : Number(t.claim_expires);
          if (expires != null && expires < now) {
            alerts.push(`⏳ wygasły claim: ${String(t.title).slice(0, 70)} [${board}]`);
          }
        }
      }
    } catch (err) {
      process.stderr.write(`alerts: ${board}: ${err.message}\n`);
    } finally {
      if (db) db.close();
    }
  }

  // Broker queue stuck
  try {
    if (fs.existsSync(STATE_DB)) {
      const db = openRO(STATE_DB);
      try {
        const stale = db.prepare(
          "SELECT id, action, created_at FROM task_moves WHERE status='queued' AND created_at < ? LIMIT 5"
        ).all(now - QUEUE_STALE_MIN * MINUTE);
        for (const m of stale) {
          alerts.push(`📥 ruch utknął w kolejce (${fmtAge((now - Number(m.created_at)) / HOUR)}): ${String(m.id).slice(0, 24)}`);
        }
        const cmd = db.prepare("SELECT COUNT(*) c FROM commands WHERE status='pending' AND created_at < ?").get(now - QUEUE_STALE_MIN * MINUTE);
        if (Number(cmd.c) > 0) alerts.push(`📥 ${cmd.c} komend brokerowych czeka > ${QUEUE_STALE_MIN}m`);
      } finally { db.close(); }
    }
  } catch { /* state DB unavailable — skip queue alerts */ }

  return alerts;
}

const alerts = collectAlerts();
if (alerts.length) {
  const now = new Date();
  const header = `🚨 AOC Alerts — ${now.toLocaleDateString("pl-PL")} ${now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}\n`;
  const body = alerts.join("\n") + "\n";
  // EPIPE-safe: downstream (head, cron pipelines) may close the pipe early.
  process.stdout.on("error", () => process.exit(0));
  process.stdout.write(header + body, () => process.exit(0));
} else {
  process.exit(0); // empty stdout = silent (no delivery)
}
