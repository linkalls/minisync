import type { Database } from "bun:sqlite";
import type { AsyncDatabase } from "./types";

// ── Bun SQLite adapter ────────────────────────────────────────────────────────

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

// ── Shared minimal interface for synchronous SQLite drivers ──────────────────

/**
 * Minimal interface satisfied by `better-sqlite3`, `node:sqlite` (`DatabaseSync`),
 * and Deno's `@db/sqlite` — all of which use a synchronous, prepare-based API.
 *
 * Pass an instance of any of these databases to the corresponding adapter function.
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
 * Internal factory shared by the three synchronous SQLite adapters.
 * Wraps a `SyncSqliteDatabase` driver into the `AsyncDatabase` interface.
 */
function makeSyncAdapter(db: SyncSqliteDatabase): AsyncDatabase {
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
      // All three sync drivers use standard SQL transaction control.
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

// ── better-sqlite3 adapter ────────────────────────────────────────────────────

/**
 * Adapts a `better-sqlite3` `Database` to the `AsyncDatabase` interface.
 *
 * ```ts
 * import Database from "better-sqlite3";
 * import { betterSqlite3Adapter } from "minisync";
 *
 * const db = betterSqlite3Adapter(new Database("app.db"));
 * ```
 */
export function betterSqlite3Adapter(db: SyncSqliteDatabase): AsyncDatabase {
  return makeSyncAdapter(db);
}

// ── node:sqlite adapter ───────────────────────────────────────────────────────

/**
 * Adapts a `node:sqlite` `DatabaseSync` to the `AsyncDatabase` interface.
 * Requires Node.js 22.5 or later (the `node:sqlite` built-in module).
 *
 * ```ts
 * import { DatabaseSync } from "node:sqlite";
 * import { nodeSqliteAdapter } from "minisync";
 *
 * const db = nodeSqliteAdapter(new DatabaseSync("app.db"));
 * ```
 */
export function nodeSqliteAdapter(db: SyncSqliteDatabase): AsyncDatabase {
  return makeSyncAdapter(db);
}

// ── Deno @db/sqlite adapter ───────────────────────────────────────────────────

/**
 * Adapts a Deno `@db/sqlite` `Database` to the `AsyncDatabase` interface.
 *
 * ```ts
 * import { Database } from "@db/sqlite";
 * import { denoSqliteAdapter } from "minisync";
 *
 * const db = denoSqliteAdapter(new Database("app.db"));
 * ```
 */
export function denoSqliteAdapter(db: SyncSqliteDatabase): AsyncDatabase {
  return makeSyncAdapter(db);
}

// ── libsql (@libsql/client) adapter ──────────────────────────────────────────

/** Minimal result set returned by a libsql `execute` call. */
interface LibsqlResultSet {
  rows: Record<string, unknown>[];
}

/** Minimal interface for a libsql transaction (returned by `client.transaction()`). */
export interface LibsqlTransaction {
  execute(opts: { sql: string; args?: unknown[] }): Promise<LibsqlResultSet>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Minimal interface satisfied by `@libsql/client` `Client`.
 * Pass the result of `createClient(...)` to `libsqlAdapter`.
 */
export interface LibsqlClient {
  execute(opts: { sql: string; args?: unknown[] }): Promise<LibsqlResultSet>;
  transaction(mode?: "write" | "read" | "deferred"): Promise<LibsqlTransaction>;
}

function makeLibsqlAdapter(
  executor: Pick<LibsqlClient, "execute">,
  client: LibsqlClient,
): AsyncDatabase {
  const adapter: AsyncDatabase = {
    async exec(sql: string, params?: unknown[]): Promise<void> {
      await executor.execute({ sql, args: params ?? [] });
    },
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await executor.execute({ sql, args: params ?? [] });
      return result.rows as T[];
    },
    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await executor.execute({ sql, args: params ?? [] });
      return (result.rows[0] as T) ?? null;
    },
    async transaction<T>(fn: (tx: AsyncDatabase) => Promise<T> | T): Promise<T> {
      const tx = await client.transaction("write");
      try {
        const result = await fn(makeLibsqlAdapter(tx, client));
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    },
  };
  return adapter;
}

/**
 * Adapts a `@libsql/client` `Client` to the `AsyncDatabase` interface.
 * Works with both local (`file:`) and remote (`libsql://`) libsql databases.
 *
 * ```ts
 * import { createClient } from "@libsql/client";
 * import { libsqlAdapter } from "minisync";
 *
 * const db = libsqlAdapter(createClient({ url: "file:app.db" }));
 * // or Turso remote:
 * const db = libsqlAdapter(createClient({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_TOKEN! }));
 * ```
 */
export function libsqlAdapter(client: LibsqlClient): AsyncDatabase {
  return makeLibsqlAdapter(client, client);
}
