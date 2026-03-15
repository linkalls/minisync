import { bunSqliteAdapter } from "./adapters/bun-sqlite";
import type { AsyncDatabase } from "./types";

export function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Accepts either a raw Bun SQLite `Database` (detected by the presence of a
 * `.prepare` method) or an `AsyncDatabase` adapter, and returns an
 * `AsyncDatabase` in both cases.
 */
export function normalizeToAsyncDb(db: AsyncDatabase | object): AsyncDatabase {
  if ("prepare" in db && typeof (db as { prepare: unknown }).prepare === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return bunSqliteAdapter(db as any);
  }
  return db as AsyncDatabase;
}
