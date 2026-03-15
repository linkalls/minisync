import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createSyncClient, type SyncClient } from "./client";
import { installSync, syncTable } from "./schema";
import { bunSqliteAdapter } from "./adapters/bun-sqlite";
import type { AsyncDatabase, SyncBackend, SyncClientOptions } from "./types";

/** Detect whether `db` is a raw Bun SQLite `Database` (has `.prepare`) rather than an `AsyncDatabase`. */
function normalizeDb(db: AsyncDatabase | object): AsyncDatabase {
  if ("prepare" in db && typeof (db as { prepare: unknown }).prepare === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return bunSqliteAdapter(db as any);
  }
  return db as AsyncDatabase;
}

export interface CreateDrizzleSyncClientOptions {
  /**
   * The database to sync. Accepts either an `AsyncDatabase` adapter or a raw
   * Bun SQLite `Database` instance — the latter is automatically wrapped with
   * `bunSqliteAdapter` for convenience.
   */
  db: AsyncDatabase | object;
  backend: SyncBackend;
  userId: string;
  schema: SQLiteTable[];
  autoInstall?: boolean;
  intervalMs?: number;
  autoStart?: boolean;
  batchSize?: number;
  onSyncStart?: SyncClientOptions["onSyncStart"];
  onSyncSuccess?: SyncClientOptions["onSyncSuccess"];
  onConflict?: SyncClientOptions["onConflict"];
  onError?: SyncClientOptions["onError"];
}

export async function createDrizzleSyncClient(options: CreateDrizzleSyncClientOptions): Promise<SyncClient> {
  const db = normalizeDb(options.db);
  const tables = options.schema.map((table) => syncTable(table));
  if (options.autoInstall ?? true) {
    await installSync({
      db,
      tables,
    });
  }

  return createSyncClient({
    db,
    backend: options.backend,
    userId: options.userId,
    tables: tables.map((table) => table.name),
    intervalMs: options.intervalMs,
    autoStart: options.autoStart,
    batchSize: options.batchSize,
    onSyncStart: options.onSyncStart,
    onSyncSuccess: options.onSyncSuccess,
    onConflict: options.onConflict,
    onError: options.onError,
  });
}
