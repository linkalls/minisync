import type { TriggerSqlOptions } from "./sql";
import { installSync, syncTable, type SyncTableConfig } from "./schema";
import type { AsyncDatabase } from "./types";

export interface SetupTable extends TriggerSqlOptions {
  name: string;
  columns: string[];
  omitColumns?: string[];
}

export async function setupSync(db: AsyncDatabase, tables: SetupTable[]) {
  await installSync({
    db,
    tables: tables.map((table) => syncTable(table.name, table as SyncTableConfig)),
  });
}
