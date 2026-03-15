import { resolveLww } from "./conflict";
import type { PullRequest, PullResponse, PushRequest, PushResponse, SyncBackend, SyncChange } from "./types";
import { quoteIdentifier } from "./utils";
import type { InsertRemoteChangeRow } from "./sqlite-schema";
import { remoteChangesTable } from "./sqlite-schema";
import { getTableColumns } from "drizzle-orm";

import type { AsyncDatabase } from "./types";

export interface SqliteBackendOptions {
  db: AsyncDatabase;
  changesTable?: string;
}

// Raw column names taken directly from the Drizzle schema to avoid drift.
const col = getTableColumns(remoteChangesTable);
const C = {
  checkpoint: col.checkpoint.name,
  tableName: col.tableName.name,
  op: col.op.name,
  rowId: col.rowId.name,
  userId: col.userId.name,
  hlc: col.hlc.name,
  deleted: col.deleted.name,
  payload: col.payload.name,
} as const;

/**
 * Shape of a row as returned by raw SQL queries against `_remote_changes`.
 * Keys are snake_case SQL column names (from the Drizzle schema via `C`);
 * types mirror `InsertRemoteChangeRow`.
 *
 * The mapped type `as (typeof C)[K]` re-maps each camelCase key in `C`
 * to the actual SQL column name it holds (e.g. `"tableName"` → `"table_name"`).
 */
type RawRemoteChangeRow = {
  [K in keyof typeof C as (typeof C)[K]]: K extends "deleted"
    ? number
    : K extends "op"
      ? InsertRemoteChangeRow["op"]
      : string;
};

export class SqliteSyncBackend implements SyncBackend {
  private readonly changesTable: string;
  private initialized = false;

  constructor(private readonly options: SqliteBackendOptions) {
    this.changesTable = options.changesTable ?? "_remote_changes";
  }

  private async ensureInit() {
    if (!this.initialized) {
      await this.init();
      this.initialized = true;
    }
  }

  async init() {
    const t = quoteIdentifier(this.changesTable);
    await this.options.db.exec(
      `CREATE TABLE IF NOT EXISTS ${t} (
        ${C.checkpoint} TEXT PRIMARY KEY,
        ${C.tableName}  TEXT NOT NULL,
        ${C.op}         TEXT NOT NULL,
        ${C.rowId}      TEXT NOT NULL,
        ${C.userId}     TEXT NOT NULL,
        ${C.hlc}        TEXT NOT NULL,
        ${C.deleted}    INTEGER NOT NULL DEFAULT 0,
        ${C.payload}    TEXT NOT NULL
      );`,
    );
    await this.options.db.exec(
      `CREATE INDEX IF NOT EXISTS ${this.changesTable}_user_checkpoint_idx
         ON ${t}(${C.userId}, ${C.checkpoint});`,
    );
  }

  async pullChanges(request: PullRequest): Promise<PullResponse> {
    await this.ensureInit();
    const t = quoteIdentifier(this.changesTable);
    let queryStr =
      `SELECT ${C.checkpoint}, ${C.tableName}, ${C.op}, ${C.rowId}, ${C.userId}, ${C.hlc}, ${C.deleted}, ${C.payload}` +
      ` FROM ${t}` +
      ` WHERE ${C.userId} = ?1 AND (?2 IS NULL OR ${C.checkpoint} > ?2)`;
    const params: unknown[] = [request.userId, request.checkpoint ?? null];

    if (request.tables && request.tables.length > 0) {
      const placeholders = request.tables.map(() => "?").join(", ");
      queryStr += ` AND ${C.tableName} IN (${placeholders})`;
      params.push(...request.tables);
    }

    queryStr += ` ORDER BY ${C.checkpoint} ASC`;

    const limit = request.limit ?? 100;
    queryStr += ` LIMIT ${limit + 1}`;

    const rows = (await this.options.db.query(queryStr, params)) as RawRemoteChangeRow[];

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const changes = resultRows.map(
      (row) =>
        ({
          table: row[C.tableName],
          op: row[C.op],
          row: {
            id: row[C.rowId],
            userId: row[C.userId],
            data: JSON.parse(row[C.payload]) as Record<string, never>,
            hlc: row[C.hlc],
            deleted: Boolean(row[C.deleted]),
          },
        }) satisfies SyncChange,
    );

    const latest = resultRows.at(-1)?.[C.checkpoint] ?? request.checkpoint ?? "";
    return { checkpoint: latest, changes, hasMore };
  }

  async pushChanges(request: PushRequest): Promise<PushResponse> {
    await this.ensureInit();
    const t = quoteIdentifier(this.changesTable);
    let accepted = 0;
    let latest = "";

    for (const change of request.changes) {
      if (change.row.userId !== request.userId) throw new Error("ownership mismatch");

      const existing = (await this.options.db.get(
        `SELECT ${C.checkpoint}, ${C.tableName}, ${C.op}, ${C.rowId}, ${C.userId}, ${C.hlc}, ${C.deleted}, ${C.payload}` +
          ` FROM ${t}` +
          ` WHERE ${C.tableName} = ?1 AND ${C.rowId} = ?2 AND ${C.userId} = ?3` +
          ` ORDER BY ${C.checkpoint} DESC LIMIT 1`,
        [change.table, change.row.id, change.row.userId],
      )) as RawRemoteChangeRow | null;

      const finalRow = existing
        ? resolveLww(
            {
              id: existing[C.rowId],
              userId: existing[C.userId],
              data: JSON.parse(existing[C.payload]) as Record<string, never>,
              hlc: existing[C.hlc],
              deleted: Boolean(existing[C.deleted]),
            },
            change.row,
          )
        : change.row;

      const finalOp: InsertRemoteChangeRow["op"] = finalRow.deleted ? "delete" : "upsert";
      latest = finalRow.hlc;

      await this.options.db.exec(
        `INSERT OR REPLACE INTO ${t}` +
          ` (${C.checkpoint}, ${C.tableName}, ${C.op}, ${C.rowId}, ${C.userId}, ${C.hlc}, ${C.deleted}, ${C.payload})` +
          ` VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        [latest, change.table, finalOp, finalRow.id, finalRow.userId, finalRow.hlc, finalRow.deleted ? 1 : 0, JSON.stringify(finalRow.data)],
      );
      accepted += 1;
    }

    return {
      accepted,
      checkpoint: latest,
      acknowledgedIds: request.changes.map((change) => `${change.table}:${change.row.id}`),
    };
  }
}

