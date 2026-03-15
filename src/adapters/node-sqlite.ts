import type { AsyncDatabase } from "../types";
import { makeSyncAdapter } from "./sync-driver";
import type { SyncSqliteDatabase } from "./sync-driver";

export type { SyncSqliteDatabase };

/**
 * Adapts a `node:sqlite` `DatabaseSync` to the `AsyncDatabase` interface.
 * Requires Node.js 22.5 or later (the `node:sqlite` built-in module).
 *
 * ```ts
 * import { DatabaseSync } from "node:sqlite";
 * import { nodeSqliteAdapter } from "minisync/node-sqlite";
 *
 * const db = nodeSqliteAdapter(new DatabaseSync("app.db"));
 * ```
 */
export function nodeSqliteAdapter(db: SyncSqliteDatabase): AsyncDatabase {
  return makeSyncAdapter(db);
}
