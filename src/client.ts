import { nextHlc } from "./hlc";
import { resolveLww } from "./conflict";
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

  start() {
    this.init();
  }

  stop() {
    // no-op for MVP
  }

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

  private applyRemoteChange(change: SyncChange) {
    const currentHlc = this.options.db
      .query("SELECT value FROM _sync_state WHERE key = ?1")
      .get(`row_hlc:${change.table}:${change.row.id}`) as { value: string } | null;

    if (currentHlc) {
      const localDeleted = this.options.db
        .query("SELECT value FROM _sync_state WHERE key = ?1")
        .get(`row_deleted:${change.table}:${change.row.id}`) as { value: string } | null;
      const localRow: SyncRow = {
        id: change.row.id,
        userId: change.row.userId,
        data: {},
        hlc: currentHlc.value,
        deleted: localDeleted?.value === "1",
      };
      const winner = resolveLww(localRow, change.row);
      if (winner.hlc !== change.row.hlc) return;
    }

    const columns = Object.keys(change.row.data);
    if (!change.row.deleted && columns.length > 0) {
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map((column) => change.row.data[column]);
      const updateAssignments = columns.map((column) => `${column} = excluded.${column}`).join(", ");
      this.options.db
        .query(
          `INSERT INTO ${change.table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateAssignments}`,
        )
        .run(...values);
    }

    if (change.row.deleted) {
      this.options.db.query(`DELETE FROM ${change.table} WHERE id = ?1`).run(change.row.id);
    }

    this.setState(`row_hlc:${change.table}:${change.row.id}`, change.row.hlc);
    this.setState(`row_deleted:${change.table}:${change.row.id}`, change.row.deleted ? "1" : "0");
  }

  async pull(): Promise<number> {
    const checkpoint = this.getState("checkpoint") || undefined;
    const response = await this.options.backend.pullChanges({
      userId: this.options.userId,
      checkpoint,
      tables: this.options.tables,
    });
    for (const change of response.changes) {
      this.applyRemoteChange(change);
    }
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
