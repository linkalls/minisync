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
      void this.start();
    }
  }

  async start() {
    await this.init();
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

  async init() {
    await this.options.db.exec("INSERT OR IGNORE INTO _sync_state (key, value) VALUES ('checkpoint', '')");
    await this.options.db.exec("INSERT OR IGNORE INTO _sync_state (key, value) VALUES ('last_hlc', '')");
  }

  private emitError(error: unknown) {
    this.options.onError?.({ error });
  }

  private async getState(key: string, tx?: import("./types").AsyncDatabase): Promise<string> {
    const db = tx ?? this.options.db;
    const row = await db.get<{ value: string }>("SELECT value FROM _sync_state WHERE key = ?1", [key]);
    return row?.value ?? "";
  }

  private async setState(key: string, value: string, tx?: import("./types").AsyncDatabase) {
    const db = tx ?? this.options.db;
    await db.exec("INSERT INTO _sync_state(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
  }

  private async readQueuedChanges(limit?: number, minSeq?: number, tx?: import("./types").AsyncDatabase): Promise<QueueRow[]> {
    const db = tx ?? this.options.db;
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
    return await db.query(queryStr, params) as QueueRow[];
  }

  private async lockQueuedRows(rows: QueueRow[], tx?: import("./types").AsyncDatabase) {
    const db = tx ?? this.options.db;
    for (const row of rows) {
      await db.exec("UPDATE _sync_queue SET locked = 1 WHERE seq = ?1", [row.seq]);
    }
  }

  private async acknowledgeQueuedRows(rows: QueueRow[], tx?: import("./types").AsyncDatabase) {
    const db = tx ?? this.options.db;
    for (const row of rows) {
      await db.exec("DELETE FROM _sync_queue WHERE seq = ?1", [row.seq]);
    }
  }

  private async failQueuedRows(rows: QueueRow[], error: unknown, tx?: import("./types").AsyncDatabase) {
    const db = tx ?? this.options.db;
    const message = error instanceof Error ? error.message : String(error);
    for (const row of rows) {
      await db.exec(
        "UPDATE _sync_queue SET locked = 0, attempts = attempts + 1, last_error = ?2, dead_lettered = CASE WHEN attempts + 1 >= 10 THEN 1 ELSE 0 END WHERE seq = ?1",
        [row.seq, message]
      );
    }
  }

  private async mapQueueRow(row: QueueRow, tx?: import("./types").AsyncDatabase): Promise<SyncChange> {
    const last = await this.getState("last_hlc", tx);
    const hlc = nextHlc({ last, nodeId: "client" });
    await this.setState("last_hlc", hlc, tx);
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
      let queued = await this.readQueuedChanges(batchSize, lastSeq);
      if (queued.length === 0) break;

      const latestSeqMap = new Map<string, number>();
      for (const row of queued) {
        latestSeqMap.set(`${row.table_name}:${row.row_id}`, row.seq);
      }

      const redundantRows = queued.filter((row) => latestSeqMap.get(`${row.table_name}:${row.row_id}`) !== row.seq);
      if (redundantRows.length > 0) {
        await this.options.db.transaction(async (tx) => {
          await this.acknowledgeQueuedRows(redundantRows, tx);
        });
        queued = queued.filter((row) => latestSeqMap.get(`${row.table_name}:${row.row_id}`) === row.seq);
      }

      if (queued.length === 0) {
        lastSeq = redundantRows[redundantRows.length - 1]?.seq ?? lastSeq;
        continue;
      }

      await this.lockQueuedRows(queued);
      try {
        const mapped: SyncChange[] = [];
        for (const row of queued) {
          mapped.push(await this.mapQueueRow(row));
        }
        const response = await this.options.backend.pushChanges({
          userId: this.options.userId,
          changes: mapped,
        });

        const ackIds = new Set(response.acknowledgedIds ?? mapped.map((change) => `${change.table}:${change.row.id}`));
        const acknowledgedRows = queued.filter((row) => ackIds.has(`${row.table_name}:${row.row_id}`));
        const rejectedRows = queued.filter((row) => !ackIds.has(`${row.table_name}:${row.row_id}`));

        await this.options.db.transaction(async (tx) => {
          await this.acknowledgeQueuedRows(acknowledgedRows, tx);
          if (rejectedRows.length > 0) {
            for (const row of rejectedRows) {
              const rejection = response.rejected?.find((item) => item.id === `${row.table_name}:${row.row_id}`);
              await tx.exec(
                "UPDATE _sync_queue SET locked = 0, attempts = attempts + 1, last_error = ?2, dead_lettered = CASE WHEN attempts + 1 >= 10 THEN 1 ELSE 0 END WHERE seq = ?1",
                [row.seq, rejection?.reason ?? "rejected by backend"]
              );
            }
          }
          await this.setState("checkpoint", response.checkpoint, tx);
        });

        totalPushed += response.accepted;
        lastSeq = queued[queued.length - 1].seq;

        if (queued.length < batchSize) break;
      } catch (error) {
        await this.failQueuedRows(queued, error);
        this.emitError(error);
        throw error;
      }
    }

    return totalPushed;
  }

  private async applyRemoteChange(change: SyncChange, tx?: import("./types").AsyncDatabase) {
    const db = tx ?? this.options.db;
    const currentHlc = await db.get<{ value: string }>("SELECT value FROM _sync_state WHERE key = ?1", [`row_hlc:${change.table}:${change.row.id}`]);

    if (currentHlc) {
      const localDeleted = await db.get<{ value: string }>("SELECT value FROM _sync_state WHERE key = ?1", [`row_deleted:${change.table}:${change.row.id}`]);
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
      await db.exec(
        `INSERT INTO ${quoteIdentifier(change.table)} (${quotedColumns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateAssignments}`,
        values
      );
    }

    if (change.row.deleted) {
      await db.exec(`DELETE FROM ${quoteIdentifier(change.table)} WHERE id = ?1`, [change.row.id]);
    }

    await this.setState(`row_hlc:${change.table}:${change.row.id}`, change.row.hlc, tx);
    await this.setState(`row_deleted:${change.table}:${change.row.id}`, change.row.deleted ? "1" : "0", tx);
  }

  async pull(): Promise<number> {
    let checkpoint = await this.getState("checkpoint") || undefined;
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

      await this.options.db.transaction(async (tx) => {
        try {
          await this.setState("is_syncing", "1", tx);
          for (const change of response.changes) {
            await this.applyRemoteChange(change, tx);
          }
          await this.setState("checkpoint", response.checkpoint, tx);
        } finally {
          await this.setState("is_syncing", "0", tx);
        }
      });

      totalPulled += response.changes.length;
      checkpoint = response.checkpoint;

      hasMore = response.hasMore ?? (response.changes.length >= batchSize);
    }

    return totalPulled;
  }

  async syncNow(): Promise<{ pushed: number; pulled: number }> {
    const queuedChanges = await this.readQueuedChanges();
    const queued = queuedChanges.length;
    const initialCheckpoint = await this.getState("checkpoint");
    this.options.onSyncStart?.({ queued, checkpoint: initialCheckpoint || undefined });
    try {
      const pushed = await this.push();
      const pulled = await this.pull();
      const checkpoint = await this.getState("checkpoint");
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
