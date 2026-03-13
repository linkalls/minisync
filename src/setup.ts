import { metadataSql, triggerSql } from "./sql";

export interface SetupTable {
  name: string;
  columns: string[];
}

export function setupSync(db: Database, tables: SetupTable[]) {
  for (const sql of metadataSql()) db.exec(sql);
  for (const table of tables) {
    for (const sql of triggerSql(table.name, table.columns)) {
      db.exec(sql);
    }
  }
}
