export interface QueueEntry {
  seq: number;
  table_name: string;
  op: string;
  row_id: string;
  user_id: string | null;
  hlc: string;
  payload: string;
}

export function inspectQueue(db: Database): QueueEntry[] {
  return db.query("SELECT seq, table_name, op, row_id, user_id, hlc, payload FROM _sync_queue ORDER BY seq ASC").all() as QueueEntry[];
}

export function inspectState(db: Database): Record<string, string> {
  const rows = db.query("SELECT key, value FROM _sync_state ORDER BY key ASC").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
