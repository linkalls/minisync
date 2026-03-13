import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SetupTable } from "./setup";

export interface DrizzleSyncTable extends SetupTable {
  drizzle?: SQLiteTable;
}

export function defineSyncTable(name: string, columns: string[]): SetupTable {
  return { name, columns };
}

export function defineDrizzleSyncTable(table: SQLiteTable, columns: string[]): DrizzleSyncTable {
  return {
    name: table[Symbol.for("drizzle:Name")] as string,
    columns,
    drizzle: table,
  };
}
