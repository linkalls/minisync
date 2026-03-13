import { nextHlc } from "./hlc";
import type { SyncChange, SyncClientOptions, SyncRow } from "./types";

interface QueueRow {
  seq: number;
  table_name: string;
  op: "upsert" | "delete";
  row_id: string;
  user_id: string;
  hlc: string;
  payload: string;
}

export class SyncClient {
  constructor(private readonly options: SyncClientOptions) {}

  init() {
    this.options.db.exec("INSERT OR IGNORE INTO _sync_state (key, value) VALUES ('checkpoint', '')");
    this.options.db.exec("INSERT OR IGNORE INTO _sync_state (key, value) VALUES ('last_hlc', '')");
  }

  private getState(key: string): string {
    const row = this.options.db
      .query("SELECT value FROM _sync_state WHERE key = ?1")
      .get(key) as { value: string } | null;
    return row?.value ?? "";
  }

  private setState(key: string, value: string) {
    this.options.db
      .query("INSERT INTO _sync_state(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  private readQueuedChanges(): QueueRow[] {
    const placeholders = this.options.tables.map(() => "?").join(", ");
    return this.options.db
      .query(`SELECT seq, table_name, op, row_id, user_id, hlc, payload FROM _sync_queue WHERE table_name IN (${placeholders}) ORDER BY seq ASC`)
      .all(...this.options.tables) as QueueRow[];
  }

  private mapQueueRow(row: QueueRow): SyncChange {
    const last = this.getState("last_hlc");
    const hlc = nextHlc({ last, nodeId: "client" });
    this.setState("last_hlc", hlc);
    const payload = JSON.parse(row.payload) as Record<string, string | number | boolean | null>;
    const syncRow: SyncRow = {
      id: row.row_id,
      userId: row.user_id ?? this.options.userId,
      data: payload,
      hlc,
      deleted: row.op === "delete",
    };
    return { table: row.table_name, op: row.op, row: syncRow };
  }

  async push(): Promise<number> {
    const queued = this.readQueuedChanges();
    if (queued.length === 0) return 0;
    const response = await this.options.backend.pushChanges({
      userId: this.options.userId,
      changes: queued.map((row) => this.mapQueueRow(row)),
    });
    this.options.db.exec("DELETE FROM _sync_queue");
    this.setState("checkpoint", response.checkpoint);
    return response.accepted;
  }

  async pull(): Promise<number> {
    const checkpoint = this.getState("checkpoint") || undefined;
    const response = await this.options.backend.pullChanges({
      userId: this.options.userId,
      checkpoint,
      tables: this.options.tables,
    });
    this.setState("checkpoint", response.checkpoint);
    return response.changes.length;
  }

  async syncNow(): Promise<{ pushed: number; pulled: number }> {
    const pushed = await this.push();
    const pulled = await this.pull();
    return { pushed, pulled };
  }
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  return new SyncClient(options);
}
