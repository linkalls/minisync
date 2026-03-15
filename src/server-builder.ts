import type { AuthAdapter } from "./auth";
import type { AsyncDatabase } from "./types";
import { normalizeToAsyncDb } from "./utils";
import { SqliteSyncBackend } from "./sqlite-backend";
import { createSyncServer } from "./server";

export interface CreateDrizzleSyncServerOptions {
  /**
   * The SQLite database for server-side change storage.
   * Accepts either an `AsyncDatabase` adapter or a raw Bun SQLite `Database`
   * instance (automatically wrapped with `bunSqliteAdapter`).
   *
   * For other runtimes wrap first:
   * ```ts
   * import { betterSqlite3Adapter } from "minisync/better-sqlite3";
   * createDrizzleSyncServer({ db: betterSqlite3Adapter(db), ... });
   * ```
   */
  db: AsyncDatabase | object;

  /**
   * Optional auth adapter.  If omitted, the `userId` from the request body
   * is used as-is (only appropriate for trusted environments / development).
   */
  auth?: AuthAdapter;

  /**
   * Name of the table that stores server-side change history.
   * Defaults to `"_remote_changes"`.
   */
  changesTable?: string;
}

/**
 * Creates a fully configured sync server (a Hono app) backed by a local
 * SQLite database.  This is the server-side counterpart of
 * `createDrizzleSyncClient`.
 *
 * ```ts
 * // Bun — place in server.ts or app/api/sync/[action]/route.ts
 * import { Database } from "bun:sqlite";
 * import { createDrizzleSyncServer, bearerTokenAuth } from "minisync";
 *
 * const sync = await createDrizzleSyncServer({
 *   db: new Database("server.db"),
 *   auth: bearerTokenAuth({
 *     resolve: async (token) => token ? { userId: token } : null,
 *   }),
 * });
 *
 * export default { port: 3000, fetch: sync.fetch };
 * ```
 */
export async function createDrizzleSyncServer(options: CreateDrizzleSyncServerOptions) {
  const db = normalizeToAsyncDb(options.db);
  const backend = new SqliteSyncBackend({ db, changesTable: options.changesTable });
  // ensureInit is called lazily inside SqliteSyncBackend, but calling it here
  // surfaces schema errors at startup time rather than on the first request.
  await backend.init();
  return createSyncServer({ backend, auth: options.auth });
}
