export function metadataSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS _sync_queue (\n      seq INTEGER PRIMARY KEY AUTOINCREMENT,\n      table_name TEXT NOT NULL,\n      op TEXT NOT NULL,\n      row_id TEXT NOT NULL,\n      user_id TEXT,\n      hlc TEXT NOT NULL,\n      payload TEXT NOT NULL\n    );`,
    `CREATE TABLE IF NOT EXISTS _sync_state (\n      key TEXT PRIMARY KEY,\n      value TEXT NOT NULL\n    );`,
  ];
}

export function triggerSql(table: string, columns: string[]): string[] {
  const jsonObjectArgs = columns.flatMap((column) => [`'${column}'`, `NEW.${column}`]).join(", ");
  const oldUser = columns.includes("user_id") ? "OLD.user_id" : "NULL";
  const newUser = columns.includes("user_id") ? "NEW.user_id" : "NULL";
  return [
    `CREATE TRIGGER IF NOT EXISTS ${table}_sync_insert AFTER INSERT ON ${table} BEGIN\n      INSERT INTO _sync_queue (table_name, op, row_id, user_id, hlc, payload)\n      VALUES ('${table}', 'upsert', NEW.id, ${newUser}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object(${jsonObjectArgs}));\n    END;`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_sync_update AFTER UPDATE ON ${table} BEGIN\n      INSERT INTO _sync_queue (table_name, op, row_id, user_id, hlc, payload)\n      VALUES ('${table}', 'upsert', NEW.id, ${newUser}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object(${jsonObjectArgs}));\n    END;`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_sync_delete AFTER DELETE ON ${table} BEGIN\n      INSERT INTO _sync_queue (table_name, op, row_id, user_id, hlc, payload)\n      VALUES ('${table}', 'delete', OLD.id, ${oldUser}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object('id', OLD.id));\n    END;`,
  ];
}
