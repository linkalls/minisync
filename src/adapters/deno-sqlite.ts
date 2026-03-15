import type { AsyncDatabase } from "../types";
import { makeSyncAdapter } from "./sync-driver";
import type { SyncSqliteDatabase } from "./sync-driver";

export type { SyncSqliteDatabase };

/**
 * Adapts a Deno `@db/sqlite` `Database` to the `AsyncDatabase` interface.
 *
 * ```ts
 * import { Database } from "@db/sqlite";
 * import { denoSqliteAdapter } from "minisync/deno-sqlite";
 *
 * const db = denoSqliteAdapter(new Database("app.db"));
 * ```
 */
export function denoSqliteAdapter(db: SyncSqliteDatabase): AsyncDatabase {
  return makeSyncAdapter(db);
}
