/**
 * Internal module shared by the three synchronous SQLite adapter wrappers
 * (better-sqlite3, node:sqlite, Deno @db/sqlite).
 *
 * Not exported as a package subpath — use the individual adapter modules instead.
 */

import type { AsyncDatabase } from "../types";

/**
 * Minimal interface satisfied by `better-sqlite3`, `node:sqlite` (`DatabaseSync`),
 * and Deno's `@db/sqlite` — all of which expose a synchronous, prepare-based API.
 */
export interface SyncSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
}

/**
 * Internal factory shared by the synchronous SQLite adapters.
 * Wraps any `SyncSqliteDatabase` into the `AsyncDatabase` interface.
 */
export function makeSyncAdapter(db: SyncSqliteDatabase): AsyncDatabase {
  const adapter: AsyncDatabase = {
    exec(sql: string, params?: unknown[]): void {
      if (params && params.length > 0) {
        db.prepare(sql).run(...params);
      } else {
        db.exec(sql);
      }
    },
    query<T = unknown>(sql: string, params?: unknown[]): T[] {
      return db.prepare(sql).all(...(params ?? [])) as T[];
    },
    get<T = unknown>(sql: string, params?: unknown[]): T | null {
      return (db.prepare(sql).get(...(params ?? [])) as T) ?? null;
    },
    transaction<T>(fn: (tx: AsyncDatabase) => Promise<T> | T): Promise<T> {
      db.exec("BEGIN");
      return Promise.resolve()
        .then(() => fn(adapter))
        .then((result) => {
          db.exec("COMMIT");
          return result;
        })
        .catch((err) => {
          try {
            db.exec("ROLLBACK");
          } catch {
            /* ignore rollback errors */
          }
          throw err;
        });
    },
  };
  return adapter;
}
