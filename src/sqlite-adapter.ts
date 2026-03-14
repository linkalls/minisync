import type { Database } from "bun:sqlite";
import type { AsyncDatabase } from "./types";

export function bunSqliteAdapter(db: Database): AsyncDatabase {
  return {
    async exec(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        db.query(sql).run(...(params as any[]));
      } else {
        db.exec(sql);
      }
    },
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      if (params && params.length > 0) {
        return db.query(sql).all(...(params as any[])) as T[];
      }
      return db.query(sql).all() as T[];
    },
    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
      if (params && params.length > 0) {
        return (db.query(sql).get(...(params as any[])) as T) ?? null;
      }
      return (db.query(sql).get() as T) ?? null;
    },
    async transaction<T>(fn: (tx: AsyncDatabase) => Promise<T> | T): Promise<T> {
      let result: T;

      // Because Bun SQLite transaction function is synchronous, but we need to support
      // async operations inside fn, we emulate it using explicit BEGIN/COMMIT.
      db.exec("BEGIN TRANSACTION");
      try {
        result = await fn(this);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
