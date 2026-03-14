import { quoteIdentifier, unique } from "./utils";

export function metadataSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS _sync_queue (\n      seq INTEGER PRIMARY KEY AUTOINCREMENT,\n      table_name TEXT NOT NULL,\n      op TEXT NOT NULL,\n      row_id TEXT NOT NULL,\n      user_id TEXT,\n      hlc TEXT NOT NULL,\n      payload TEXT NOT NULL,\n      attempts INTEGER NOT NULL DEFAULT 0,\n      locked INTEGER NOT NULL DEFAULT 0,\n      dead_lettered INTEGER NOT NULL DEFAULT 0,\n      last_error TEXT\n    );`,
    `CREATE INDEX IF NOT EXISTS _sync_queue_table_seq_idx ON _sync_queue(table_name, seq);`,
    `CREATE TABLE IF NOT EXISTS _sync_state (\n      key TEXT PRIMARY KEY,\n      value TEXT NOT NULL\n    );`,
  ];
}

export interface TriggerSqlOptions {
  deletedAtColumn?: string;
  userIdColumn?: string;
  idColumn?: string;
}

export function triggerSql(table: string, columns: string[], options: TriggerSqlOptions = {}): string[] {
  const normalizedColumns = unique(columns);
  const userIdColumn = options.userIdColumn ?? "user_id";
  const idColumn = options.idColumn ?? "id";
  const deletedAtColumn = options.deletedAtColumn;
  const qTable = quoteIdentifier(table);
  const qId = quoteIdentifier(idColumn);
  const hasUser = normalizedColumns.includes(userIdColumn);
  const jsonObjectArgs = normalizedColumns.flatMap((column) => [`'${column}'`, `NEW.${quoteIdentifier(column)}`]).join(", ");
  const oldUser = hasUser ? `OLD.${quoteIdentifier(userIdColumn)}` : "NULL";
  const newUser = hasUser ? `NEW.${quoteIdentifier(userIdColumn)}` : "NULL";
  const notSyncingWhere = `WHERE (SELECT value FROM _sync_state WHERE key = 'is_syncing') != '1' OR (SELECT value FROM _sync_state WHERE key = 'is_syncing') IS NULL`;
  const softDeleteWhen = deletedAtColumn
    ? `WHEN OLD.${quoteIdentifier(deletedAtColumn)} IS NULL AND NEW.${quoteIdentifier(deletedAtColumn)} IS NOT NULL `
    : "";
  return [
    `DROP TRIGGER IF EXISTS ${table}_sync_insert;`,
    `CREATE TRIGGER ${table}_sync_insert AFTER INSERT ON ${qTable} BEGIN\n      INSERT INTO _sync_queue (table_name, op, row_id, user_id, hlc, payload)\n      SELECT '${table}', 'upsert', NEW.${qId}, ${newUser}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object(${jsonObjectArgs})\n      ${notSyncingWhere};\n    END;`,
    `DROP TRIGGER IF EXISTS ${table}_sync_update;`,
    `CREATE TRIGGER ${table}_sync_update AFTER UPDATE ON ${qTable} BEGIN\n      INSERT INTO _sync_queue (table_name, op, row_id, user_id, hlc, payload)\n      SELECT '${table}', 'upsert', NEW.${qId}, ${newUser}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object(${jsonObjectArgs})\n      ${notSyncingWhere};\n    END;`,
    deletedAtColumn ? `DROP TRIGGER IF EXISTS ${table}_sync_soft_delete;` : `DROP TRIGGER IF EXISTS ${table}_sync_delete;`,
    deletedAtColumn
      ? `CREATE TRIGGER ${table}_sync_soft_delete AFTER UPDATE ON ${qTable} ${softDeleteWhen}BEGIN\n      INSERT INTO _sync_queue (table_name, op, row_id, user_id, hlc, payload)\n      SELECT '${table}', 'delete', NEW.${qId}, ${newUser}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object('${idColumn}', NEW.${qId}, '${deletedAtColumn}', NEW.${quoteIdentifier(deletedAtColumn)})\n      ${notSyncingWhere};\n    END;`
      : `CREATE TRIGGER ${table}_sync_delete AFTER DELETE ON ${qTable} BEGIN\n      INSERT INTO _sync_queue (table_name, op, row_id, user_id, hlc, payload)\n      SELECT '${table}', 'delete', OLD.${qId}, ${oldUser}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object('${idColumn}', OLD.${qId})\n      ${notSyncingWhere};\n    END;`,
  ];
}
