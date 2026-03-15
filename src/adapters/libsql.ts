import type { AsyncDatabase } from "../types";

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
 * Works with both local (`file:`) and remote (`libsql://`) databases (e.g. Turso).
 *
 * ```ts
 * import { createClient } from "@libsql/client";
 * import { libsqlAdapter } from "minisync/libsql";
 *
 * const db = libsqlAdapter(createClient({ url: "file:app.db" }));
 * // or Turso remote:
 * const db = libsqlAdapter(createClient({
 *   url: process.env.TURSO_URL!,
 *   authToken: process.env.TURSO_TOKEN!,
 * }));
 * ```
 */
export function libsqlAdapter(client: LibsqlClient): AsyncDatabase {
  return makeLibsqlAdapter(client, client);
}
