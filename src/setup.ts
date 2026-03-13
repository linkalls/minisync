import { metadataSql, triggerSql, type TriggerSqlOptions } from "./sql";

export interface SetupTable extends TriggerSqlOptions {
  name: string;
  columns: string[];
}

export function setupSync(db: Database, tables: SetupTable[]) {
  for (const sql of metadataSql()) db.exec(sql);
  for (const table of tables) {
    for (const sql of triggerSql(table.name, table.columns, table)) {
      db.exec(sql);
    }
  }
}
