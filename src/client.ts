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
  dead_lettered?: number;
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

  private readQueuedChanges(limit?: number, minSeq?: number): QueueRow[] {
    const placeholders = this.options.tables.map(() => "?").join(", ");
    let queryStr = `SELECT seq, table_name, op, row_id, user_id, hlc, payload, attempts, locked, dead_lettered FROM _sync_queue WHERE locked = 0 AND dead_lettered = 0 AND table_name IN (${placeholders})`;

    const params: unknown[] = [...this.options.tables];
    if (minSeq !== undefined) {
      queryStr += ` AND seq > ?`;
      params.push(minSeq);
    }
    queryStr += ` ORDER BY seq ASC`;

    if (limit) {
      queryStr += ` LIMIT ${limit}`;
    }
    return this.options.db.query(queryStr).all(...params) as QueueRow[];
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
        .query("UPDATE _sync_queue SET locked = 0, attempts = attempts + 1, last_error = ?2, dead_lettered = CASE WHEN attempts + 1 >= 10 THEN 1 ELSE 0 END WHERE seq = ?1")
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
    const batchSize = this.options.batchSize ?? 100;
    let totalPushed = 0;
    let lastSeq = -1;

    while (true) {
      let queued = this.readQueuedChanges(batchSize, lastSeq);
      if (queued.length === 0) break;

      const latestSeqMap = new Map<string, number>();
      for (const row of queued) {
        latestSeqMap.set(`${row.table_name}:${row.row_id}`, row.seq);
      }

      const redundantRows = queued.filter((row) => latestSeqMap.get(`${row.table_name}:${row.row_id}`) !== row.seq);
      if (redundantRows.length > 0) {
        this.options.db.transaction(() => {
          this.acknowledgeQueuedRows(redundantRows);
        })();
        queued = queued.filter((row) => latestSeqMap.get(`${row.table_name}:${row.row_id}`) === row.seq);
      }

      if (queued.length === 0) {
        lastSeq = redundantRows[redundantRows.length - 1]?.seq ?? lastSeq;
        continue;
      }

      this.lockQueuedRows(queued);
      try {
        const mapped = queued.map((row) => this.mapQueueRow(row));
        const response = await this.options.backend.pushChanges({
          userId: this.options.userId,
          changes: mapped,
        });

        const ackIds = new Set(response.acknowledgedIds ?? mapped.map((change) => `${change.table}:${change.row.id}`));
        const acknowledgedRows = queued.filter((row) => ackIds.has(`${row.table_name}:${row.row_id}`));
        const rejectedRows = queued.filter((row) => !ackIds.has(`${row.table_name}:${row.row_id}`));

        this.options.db.transaction(() => {
          this.acknowledgeQueuedRows(acknowledgedRows);
          if (rejectedRows.length > 0) {
            for (const row of rejectedRows) {
              const rejection = response.rejected?.find((item) => item.id === `${row.table_name}:${row.row_id}`);
              this.options.db
                .query("UPDATE _sync_queue SET locked = 0, attempts = attempts + 1, last_error = ?2, dead_lettered = CASE WHEN attempts + 1 >= 10 THEN 1 ELSE 0 END WHERE seq = ?1")
                .run(row.seq, rejection?.reason ?? "rejected by backend");
            }
          }
          this.setState("checkpoint", response.checkpoint);
        })();

        totalPushed += response.accepted;
        lastSeq = queued[queued.length - 1].seq;

        if (queued.length < batchSize) break;
      } catch (error) {
        this.failQueuedRows(queued, error);
        this.emitError(error);
        throw error;
      }
    }

    return totalPushed;
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
    let checkpoint = this.getState("checkpoint") || undefined;
    const batchSize = this.options.batchSize ?? 100;
    let totalPulled = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.options.backend.pullChanges({
        userId: this.options.userId,
        checkpoint,
        tables: this.options.tables,
        limit: batchSize,
      });

      this.options.db.transaction(() => {
        try {
          this.setState("is_syncing", "1");
          for (const change of response.changes) {
            this.applyRemoteChange(change);
          }
          this.setState("checkpoint", response.checkpoint);
        } finally {
          this.setState("is_syncing", "0");
        }
      })();

      totalPulled += response.changes.length;
      checkpoint = response.checkpoint;

      hasMore = response.hasMore ?? (response.changes.length >= batchSize);
    }

    return totalPulled;
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
