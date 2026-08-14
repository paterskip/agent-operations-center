#!/usr/bin/env node
// Kolektor nieudanych prób logowania do AOC (Authelia).
// Wypisuje alert tylko gdy są NOWE nieudane próby (cursor w pliku) — cicho, gdy nic się nie dzieje.
// Delivered by cron (no_agent) to Telegram.
import Database from "better-sqlite3";
import fs from "node:fs";

const DB = process.env.AUTH_DB || "/var/lib/authelia/db.sqlite3";
const CURSOR = process.env.AUTH_CURSOR || "/var/lib/agent-operations-center/.auth-alert-cursor";

function main() {
  let cursor = 0;
  try { cursor = Number(fs.readFileSync(CURSOR, "utf8").trim() || "0"); } catch {}

  let rows;
  try {
    const db = new Database(DB, { readonly: true });
    rows = db.prepare(
      "SELECT id, time, username, auth_type, remote_ip, banned FROM authentication_logs WHERE id > ? AND successful = 0 ORDER BY id"
    ).all(cursor);
    db.close();
  } catch (e) {
    console.error(`AUTH-ALERT: nie można odczytać Authelia db: ${e.message}`);
    process.exit(1);
  }

  const newCursor = rows.length ? rows[rows.length - 1].id : cursor;
  if (rows.length) {
    try { fs.writeFileSync(CURSOR, String(newCursor)); } catch {}
  }
  if (!rows.length) return; // cicho

  const totp = rows.filter((r) => r.auth_type === "TOTP");
  const onefa = rows.filter((r) => r.auth_type !== "TOTP");
  const banned = rows.filter((r) => r.banned);

  const lines = [];
  if (totp.length) {
    const ips = [...new Set(totp.map((r) => r.remote_ip))].filter(Boolean).join(", ");
    lines.push(`🚨 AOC — ODRZUCONY kod 2FA (${totp.length}×)`);
    lines.push(`Ktoś podał POPRAWNE hasło, ale nie przeszedł TOTP.`);
    if (ips) lines.push(`IP: ${ips}`);
    lines.push("");
  }
  if (onefa.length) {
    const ips = [...new Set(onefa.map((r) => r.remote_ip))].filter(Boolean).join(", ");
    lines.push(`⚠️ Błędne hasło (${onefa.length}×) dla użytkownika "${[...new Set(onefa.map((r) => r.username))].join(", ")}"`);
    if (ips) lines.push(`IP: ${ips}`);
    lines.push("");
  }
  if (banned.length) lines.push(`🔒 IP zablokowane przez Authelia (${banned.length}×) — regulation: 5 prób/15 min → ban 1h`);
  lines.push(`🕐 ${new Date().toLocaleString("pl-PL")}`);

  console.log(lines.join("\n"));
}

main();
