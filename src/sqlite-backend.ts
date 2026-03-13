import { resolveLww } from "./conflict";
import type { PullRequest, PullResponse, PushRequest, PushResponse, SyncBackend, SyncChange } from "./types";
import { quoteIdentifier } from "./utils";

export interface SqliteBackendOptions {
  db: Database;
  changesTable?: string;
}

interface StoredChangeRow {
  checkpoint: string;
  table_name: string;
  op: "upsert" | "delete";
  row_id: string;
  user_id: string;
  hlc: string;
  deleted: number;
  payload: string;
}

export class SqliteSyncBackend implements SyncBackend {
  private readonly changesTable: string;

  constructor(private readonly options: SqliteBackendOptions) {
    this.changesTable = options.changesTable ?? "_remote_changes";
  }

  init() {
    const table = quoteIdentifier(this.changesTable);
    this.options.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (\n      checkpoint TEXT PRIMARY KEY,\n      table_name TEXT NOT NULL,\n      op TEXT NOT NULL,\n      row_id TEXT NOT NULL,\n      user_id TEXT NOT NULL,\n      hlc TEXT NOT NULL,\n      deleted INTEGER NOT NULL DEFAULT 0,\n      payload TEXT NOT NULL\n    );`);
    this.options.db.exec(`CREATE INDEX IF NOT EXISTS ${this.changesTable}_user_checkpoint_idx ON ${table}(user_id, checkpoint);`);
  }

  async pullChanges(request: PullRequest): Promise<PullResponse> {
    const table = quoteIdentifier(this.changesTable);
    const rows = this.options.db
      .query(`SELECT checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload FROM ${table} WHERE user_id = ?1 AND (?2 IS NULL OR checkpoint > ?2) ORDER BY checkpoint ASC`)
      .all(request.userId, request.checkpoint ?? null) as StoredChangeRow[];

    const changes = rows
      .filter((row) => !request.tables || request.tables.includes(row.table_name))
      .map((row) => ({
        table: row.table_name,
        op: row.op,
        row: {
          id: row.row_id,
          userId: row.user_id,
          data: JSON.parse(row.payload) as Record<string, never>,
          hlc: row.hlc,
          deleted: Boolean(row.deleted),
        },
      } satisfies SyncChange));

    const latest = rows.at(-1)?.checkpoint ?? request.checkpoint ?? "";
    return { checkpoint: latest, changes };
  }

  async pushChanges(request: PushRequest): Promise<PushResponse> {
    this.init();
    const table = quoteIdentifier(this.changesTable);
    let accepted = 0;
    let latest = "";

    for (const change of request.changes) {
      if (change.row.userId !== request.userId) throw new Error("ownership mismatch");
      const existing = this.options.db
        .query(`SELECT checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload FROM ${table} WHERE table_name = ?1 AND row_id = ?2 AND user_id = ?3 ORDER BY checkpoint DESC LIMIT 1`)
        .get(change.table, change.row.id, change.row.userId) as StoredChangeRow | null;

      const finalRow = existing
        ? resolveLww(
            {
              id: existing.row_id,
              userId: existing.user_id,
              data: JSON.parse(existing.payload) as Record<string, never>,
              hlc: existing.hlc,
              deleted: Boolean(existing.deleted),
            },
            change.row,
          )
        : change.row;

      const finalOp = finalRow.deleted ? "delete" : "upsert";
      latest = finalRow.hlc;
      this.options.db
        .query(`INSERT OR REPLACE INTO ${table} (checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .run(latest, change.table, finalOp, finalRow.id, finalRow.userId, finalRow.hlc, finalRow.deleted ? 1 : 0, JSON.stringify(finalRow.data));
      accepted += 1;
    }

    return { accepted, checkpoint: latest };
  }
}
