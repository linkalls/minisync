import type { TriggerSqlOptions } from "./sql";
import { installSync, syncTable, type SyncTableConfig } from "./schema";

export interface SetupTable extends TriggerSqlOptions {
  name: string;
  columns: string[];
  omitColumns?: string[];
}

export function setupSync(db: Database, tables: SetupTable[]) {
  installSync({
    db,
    tables: tables.map((table) => syncTable(table.name, table as SyncTableConfig)),
  });
}
