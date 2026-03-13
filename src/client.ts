import { nextHlc } from "./hlc";
import { resolveLww } from "./conflict";
import type { SyncChange, SyncClientOptions, SyncRow } from "./types";
import { quoteIdentifier } from "./utils";

interface QueueRow {
  seq: number;
  table_name: string;
  op: "upsert" | "delete";
  row_id: string;
  user_id: string | null;
  hlc: string;
  payload: string;
  attempts: number;
  locked: number;
}

export class SyncClient {
  private intervalId: Timer | null = null;

  constructor(private readonly options: SyncClientOptions) {
    if (options.autoStart) {
      this.start();
    }
  }

  start() {
    this.init();
    if (this.options.intervalMs && !this.intervalId) {
      this.intervalId = setInterval(() => {
        void this.syncNow().catch((error) => this.emitError(error));
      }, this.options.intervalMs);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  init() {
    this.options.db.exec("INSERT OR IGNORE INTO _sync_state (key, value) VALUES ('checkpoint', '')");
    this.options.db.exec("INSERT OR IGNORE INTO _sync_state (key, value) VALUES ('last_hlc', '')");
  }

  private emitError(error: unknown) {
    this.options.onError?.({ error });
  }

  private getState(key: string): string {
    const row = this.options.db.query("SELECT value FROM _sync_state WHERE key = ?1").get(key) as { value: string } | null;
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
      .query(
        `SELECT seq, table_name, op, row_id, user_id, hlc, payload, attempts, locked FROM _sync_queue WHERE locked = 0 AND table_name IN (${placeholders}) ORDER BY seq ASC`,
      )
      .all(...this.options.tables) as QueueRow[];
  }

  private lockQueuedRows(rows: QueueRow[]) {
    for (const row of rows) {
      this.options.db.query("UPDATE _sync_queue SET locked = 1 WHERE seq = ?1").run(row.seq);
    }
  }

  private acknowledgeQueuedRows(rows: QueueRow[]) {
    for (const row of rows) {
      this.options.db.query("DELETE FROM _sync_queue WHERE seq = ?1").run(row.seq);
    }
  }

  private failQueuedRows(rows: QueueRow[], error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    for (const row of rows) {
      this.options.db
        .query("UPDATE _sync_queue SET locked = 0, attempts = attempts + 1, last_error = ?2 WHERE seq = ?1")
        .run(row.seq, message);
    }
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
    this.lockQueuedRows(queued);
    try {
      const response = await this.options.backend.pushChanges({
        userId: this.options.userId,
        changes: queued.map((row) => this.mapQueueRow(row)),
      });
      this.acknowledgeQueuedRows(queued);
      this.setState("checkpoint", response.checkpoint);
      return response.accepted;
    } catch (error) {
      this.failQueuedRows(queued, error);
      this.emitError(error);
      throw error;
    }
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
      if (winner.hlc !== change.row.hlc) {
        this.options.onConflict?.({ change });
        return;
      }
    }

    const columns = Object.keys(change.row.data);
    if (!change.row.deleted && columns.length > 0) {
      const placeholders = columns.map(() => "?").join(", ");
      const quotedColumns = columns.map(quoteIdentifier);
      const values = columns.map((column) => change.row.data[column]);
      const updateAssignments = quotedColumns.map((column) => `${column} = excluded.${column}`).join(", ");
      this.options.db
        .query(
          `INSERT INTO ${quoteIdentifier(change.table)} (${quotedColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateAssignments}`,
        )
        .run(...values);
    }

    if (change.row.deleted) {
      this.options.db.query(`DELETE FROM ${quoteIdentifier(change.table)} WHERE id = ?1`).run(change.row.id);
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
    const queued = this.readQueuedChanges().length;
    this.options.onSyncStart?.({ queued, checkpoint: this.getState("checkpoint") || undefined });
    try {
      const pushed = await this.push();
      const pulled = await this.pull();
      const checkpoint = this.getState("checkpoint");
      this.options.onSyncSuccess?.({ pushed, pulled, checkpoint });
      return { pushed, pulled };
    } catch (error) {
      this.emitError(error);
      throw error;
    }
  }
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  return new SyncClient(options);
}
