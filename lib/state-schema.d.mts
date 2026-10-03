import type Database from "better-sqlite3";

export declare const SCHEMA_VERSION: number;

export declare function ensureSchema(
  db: Database.Database,
  opts?: { logger?: { warn?: (...args: unknown[]) => void; log?: (...args: unknown[]) => void } },
): Database.Database;
