/**
 * Single source of truth for the AOC state DB schema and its migrations.
 *
 * Why this file exists: the schema used to live in three places —
 * `scripts/process-commands.mjs`, `scripts/ensure-state-tables.mjs` and
 * `lib/state.ts` — and `CREATE TABLE IF NOT EXISTS` never alters an existing
 * table. When `commands.payload` was added, the host DB kept the old shape, so
 * the broker crashed on every run with `no such column: payload`.
 *
 * `ensureSchema(db)` is idempotent and safe to call on every broker tick
 * (the systemd timer runs it every 15 s). It creates missing tables, applies
 * additive migrations, performs a correct SQLite table rebuild when a column
 * must become nullable, and records the schema version in `PRAGMA user_version`
 * so a future divergence fails loudly instead of silently.
 *
 * It is a plain ESM module (no `db` ownership, no side effects) so both the
 * Next.js app (`lib/state.ts`) and the host broker (`scripts/process-commands.mjs`)
 * import the exact same code.
 */

/** Bump when a migration below is added. Older DB (user_version < this) migrates; newer throws. */
export const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
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
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
    target TEXT, detail TEXT, ip TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_decisions (
    id TEXT PRIMARY KEY, board TEXT NOT NULL, task_id TEXT NOT NULL, action TEXT NOT NULL,
    from_status TEXT NOT NULL, to_status TEXT, comment TEXT NOT NULL, status TEXT NOT NULL,
    result_status TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_decisions_pending
    ON task_decisions(board, task_id) WHERE status IN ('queued','running');
  CREATE TABLE IF NOT EXISTS task_moves (
    id TEXT PRIMARY KEY, board TEXT NOT NULL, task_id TEXT NOT NULL, action TEXT NOT NULL,
    from_status TEXT, to_status TEXT, title TEXT, body TEXT,
    assignee TEXT, priority INTEGER, comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, result_status TEXT, last_error TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_moves_pending
    ON task_moves(board, task_id) WHERE status IN ('queued','running');
`;

function columnInfo(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

/**
 * Rebuild `commands` to move the board payload out of the foreign-key column.
 *
 * Legacy shape: `idea_id TEXT NOT NULL` (FK -> ideas) and no `payload`. A
 * `board.create` command has no matching `ideas` row, so it could not be stored.
 * Payload now lives in `payload TEXT`; `idea_id` becomes nullable.
 *
 * SQLite's documented rebuild order is followed explicitly: `foreign_keys` is
 * turned OFF *outside* a transaction (it is a no-op inside one), the rebuild
 * runs in a transaction, and `foreign_key_check` is asserted before the pragma
 * is restored. Any FK violation aborts loudly instead of silently corrupting.
 */
function rebuildCommandsTable(db, logger) {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS commands_migrated;
        CREATE TABLE commands_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, idea_id TEXT,
          payload TEXT,
          status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY(idea_id) REFERENCES ideas(id)
        );
        INSERT INTO commands_migrated(id, kind, idea_id, payload, status, attempts, created_at, updated_at)
          SELECT id, kind,
                 CASE WHEN idea_id LIKE 'idea_%' THEN idea_id ELSE NULL END,
                 CASE WHEN idea_id LIKE 'idea_%' THEN NULL ELSE idea_id END,
                 status, attempts, created_at, updated_at
          FROM commands;
        DROP TABLE commands;
        ALTER TABLE commands_migrated RENAME TO commands;
      `);
    })();
    const violations = db.pragma("foreign_key_check");
    if (violations.length) {
      throw new Error(
        `commands rebuild left ${violations.length} FK violation(s): ` +
        JSON.stringify(violations).slice(0, 300)
      );
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
  logger?.warn?.("AOC state DB: rebuilt `commands` (legacy idea_id NOT NULL -> payload column)");
}

/**
 * Create missing tables and apply migrations in place. Returns the same `db`.
 * @param {import("better-sqlite3").Database} db
 * @param {{logger?: {warn?: Function, log?: Function}}} [opts]
 */
export function ensureSchema(db, opts = {}) {
  const logger = opts.logger ?? console;
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  const cols = columnInfo(db, "commands");
  const hasPayload = cols.some((c) => c.name === "payload");
  const ideaNotNull = cols.some((c) => c.name === "idea_id" && c.notnull === 1);

  if (!hasPayload && !ideaNotNull) {
    // Additive: the table already allows NULL idea_id, just add the column.
    db.exec("ALTER TABLE commands ADD COLUMN payload TEXT");
  } else if (!hasPayload && ideaNotNull) {
    rebuildCommandsTable(db, logger);
  }

  const version = db.pragma("user_version", { simple: true });
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `AOC state DB user_version=${version} is newer than this build supports ` +
      `(${SCHEMA_VERSION}). Refusing to run against a schema this binary does not understand.`
    );
  }
  if (version < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  return db;
}
