import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { syncTable, type SyncTableConfig } from "./schema";

export type DrizzleSyncTable = SyncTableConfig & { drizzle?: SQLiteTable };

export function defineSyncTable(name: string, columns: string[]): SyncTableConfig {
  return syncTable(name, { columns });
}

export function defineDrizzleSyncTable(
  table: SQLiteTable,
  options: Omit<SyncTableConfig, "name" | "columns"> & { columns?: string[] } = {},
): DrizzleSyncTable {
  return {
    ...syncTable(table, options),
    drizzle: table,
  };
}
