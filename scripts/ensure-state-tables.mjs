#!/usr/bin/env node
/**
 * Thin entry point that applies the shared AOC state schema + migrations.
 *
 * The schema itself lives in ONE place (`lib/state-schema.mjs`), imported by
 * both the Next.js app (`lib/state.ts`) and the host broker
 * (`scripts/process-commands.mjs`). This script exists for manual/one-off runs
 * (and as a documented operator entry point); it must never re-declare DDL,
 * because duplicated DDL is exactly what let `commands.payload` reach only some
 * databases and crash the broker for three days.
 *
 * Usage: node scripts/ensure-state-tables.mjs
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureSchema, SCHEMA_VERSION } from "../lib/state-schema.mjs";

const dbPath = process.env.AOC_STATE_DB || "/var/lib/agent-operations-center/aoc.db";

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
try {
  ensureSchema(db);
  const version = db.pragma("user_version", { simple: true });
  console.log(`State DB schema ensured at ${dbPath} (user_version=${version}, target=${SCHEMA_VERSION}).`);
} finally {
  db.close();
}
