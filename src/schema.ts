import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { metadataSql, triggerSql, type TriggerSqlOptions } from "./sql";

export interface SyncTableConfig extends TriggerSqlOptions {
  name: string;
  columns: string[];
  omitColumns?: string[];
}

function inferColumnsFromDrizzle(table: SQLiteTable): string[] {
  const columns = Object.values(table).flatMap((value) => {
    if (value && typeof value === "object" && "name" in value && typeof value.name === "string") {
      return [value.name];
    }
    return [];
  });
  return [...new Set(columns)];
}

export function syncTable(
  table: string | SQLiteTable,
  options: Omit<SyncTableConfig, "name" | "columns"> & { columns?: string[] } = {},
): SyncTableConfig {
  const name = typeof table === "string" ? table : ((table[Symbol.for("drizzle:Name")] as string) ?? "");
  const inferred = typeof table === "string" ? [] : inferColumnsFromDrizzle(table);
  const columns = (options.columns && options.columns.length > 0 ? options.columns : inferred).filter(
    (column) => !options.omitColumns?.includes(column),
  );

  if (!name) throw new Error("Could not infer table name");
  if (columns.length === 0) throw new Error(`No columns configured for sync table ${name}`);

  return {
    name,
    columns,
    deletedAtColumn: options.deletedAtColumn ?? (columns.includes("deleted_at") ? "deleted_at" : undefined),
    userIdColumn: options.userIdColumn ?? (columns.includes("user_id") ? "user_id" : undefined),
    idColumn: options.idColumn ?? (columns.includes("id") ? "id" : undefined),
    omitColumns: options.omitColumns,
  };
}

export interface InstallSyncOptions {
  db: Database;
  tables: SyncTableConfig[];
}

export function installSync(options: InstallSyncOptions) {
  for (const sql of metadataSql()) options.db.exec(sql);
  for (const table of options.tables) {
    for (const sql of triggerSql(table.name, table.columns, table)) {
      options.db.exec(sql);
    }
  }
}
