import type { AsyncDatabase } from "../types";
import { makeSyncAdapter } from "./sync-driver";
import type { SyncSqliteDatabase } from "./sync-driver";

export type { SyncSqliteDatabase };

/**
 * Adapts a `better-sqlite3` `Database` to the `AsyncDatabase` interface.
 *
 * ```ts
 * import Database from "better-sqlite3";
 * import { betterSqlite3Adapter } from "minisync/better-sqlite3";
 *
 * const db = betterSqlite3Adapter(new Database("app.db"));
 * ```
 */
export function betterSqlite3Adapter(db: SyncSqliteDatabase): AsyncDatabase {
  return makeSyncAdapter(db);
}
