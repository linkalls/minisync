import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createSyncClient, type SyncClient } from "./client";
import { installSync, syncTable } from "./schema";
import type { SyncBackend, SyncClientOptions } from "./types";

export interface CreateDrizzleSyncClientOptions {
  db: Database;
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

export function createDrizzleSyncClient(options: CreateDrizzleSyncClientOptions): SyncClient {
  const tables = options.schema.map((table) => syncTable(table));
  if (options.autoInstall ?? true) {
    installSync({
      db: options.db,
      tables,
    });
  }

  return createSyncClient({
    db: options.db,
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
