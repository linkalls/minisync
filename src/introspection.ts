import type { AsyncDatabase } from "./types";

export interface QueueEntry {
  seq: number;
  table_name: string;
  op: string;
  row_id: string;
  user_id: string | null;
  hlc: string;
  payload: string;
}

export async function inspectQueue(db: AsyncDatabase): Promise<QueueEntry[]> {
  return await db.query("SELECT seq, table_name, op, row_id, user_id, hlc, payload FROM _sync_queue ORDER BY seq ASC") as QueueEntry[];
}

export async function inspectState(db: AsyncDatabase): Promise<Record<string, string>> {
  const rows = await db.query("SELECT key, value FROM _sync_state ORDER BY key ASC") as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
