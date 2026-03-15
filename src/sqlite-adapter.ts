/**
 * Re-exports all SQLite adapter functions from their individual subpath modules.
 * Prefer importing directly from the subpath for your specific runtime:
 *
 *   import { bunSqliteAdapter }      from "minisync/bun-sqlite";
 *   import { betterSqlite3Adapter }  from "minisync/better-sqlite3";
 *   import { nodeSqliteAdapter }     from "minisync/node-sqlite";
 *   import { denoSqliteAdapter }     from "minisync/deno-sqlite";
 *   import { libsqlAdapter }         from "minisync/libsql";
 */

export { bunSqliteAdapter } from "./adapters/bun-sqlite";
export { betterSqlite3Adapter } from "./adapters/better-sqlite3";
export type { SyncSqliteDatabase } from "./adapters/better-sqlite3";
export { nodeSqliteAdapter } from "./adapters/node-sqlite";
export { denoSqliteAdapter } from "./adapters/deno-sqlite";
export { libsqlAdapter } from "./adapters/libsql";
export type { LibsqlClient, LibsqlTransaction } from "./adapters/libsql";
