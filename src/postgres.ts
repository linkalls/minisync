import type { PullRequest, PullResponse, PushRequest, PushResponse, SyncBackend } from "./types";

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface PostgresSyncBackendOptions {
  sql: SqlExecutor;
  changesTable?: string;
}

export class PostgresSyncBackend implements SyncBackend {
  private readonly changesTable: string;

  constructor(private readonly options: PostgresSyncBackendOptions) {
    this.changesTable = options.changesTable ?? "_remote_changes";
  }

  async init() {
    await this.options.sql.query(`
      create table if not exists ${this.changesTable} (
        checkpoint text primary key,
        table_name text not null,
        op text not null,
        row_id text not null,
        user_id text not null,
        hlc text not null,
        deleted boolean not null default false,
        payload jsonb not null
      )
    `);
    await this.options.sql.query(`create index if not exists ${this.changesTable}_user_checkpoint_idx on ${this.changesTable}(user_id, checkpoint)`);
  }

  async pullChanges(request: PullRequest): Promise<PullResponse> {
    const limit = request.limit ?? 100;
    const limitPlusOne = limit + 1;

    let queryStr = `
      select checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload
      from ${this.changesTable}
      where user_id = $1 and ($2::text is null or checkpoint > $2)
    `;
    const params: unknown[] = [request.userId, request.checkpoint ?? null];

    if (request.tables && request.tables.length > 0) {
      const placeholders = request.tables.map((_, i) => `$${i + 3}`).join(", ");
      queryStr += ` and table_name in (${placeholders})`;
      params.push(...request.tables);
    }

    queryStr += ` order by checkpoint asc limit $${params.length + 1}`;
    params.push(limitPlusOne);

    const result = await this.options.sql.query<{
      checkpoint: string;
      table_name: string;
      op: "upsert" | "delete";
      row_id: string;
      user_id: string;
      hlc: string;
      deleted: boolean;
      payload: Record<string, unknown>;
    }>(queryStr, params);

    let rows = result.rows;
    const hasMore = rows.length > limit;
    if (hasMore) {
      rows = rows.slice(0, limit);
    }

    return {
      checkpoint: rows.at(-1)?.checkpoint ?? request.checkpoint ?? "",
      changes: rows.map((row) => ({
        table: row.table_name,
        op: row.op,
        row: {
          id: row.row_id,
          userId: row.user_id,
          data: row.payload as never,
          hlc: row.hlc,
          deleted: row.deleted,
        },
      })),
      hasMore,
    };
  }

  async pushChanges(request: PushRequest): Promise<PushResponse> {
    await this.init();
    let accepted = 0;
    let checkpoint = "";
    for (const change of request.changes) {
      if (change.row.userId !== request.userId) throw new Error("ownership mismatch");
      checkpoint = change.row.hlc;
      await this.options.sql.query(
        `insert into ${this.changesTable} (checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (checkpoint) do update set
           table_name = excluded.table_name,
           op = excluded.op,
           row_id = excluded.row_id,
           user_id = excluded.user_id,
           hlc = excluded.hlc,
           deleted = excluded.deleted,
           payload = excluded.payload`,
        [checkpoint, change.table, change.op, change.row.id, change.row.userId, change.row.hlc, change.row.deleted, JSON.stringify(change.row.data)],
      );
      accepted += 1;
    }
    return {
      accepted,
      checkpoint,
      acknowledgedIds: request.changes.map((change) => `${change.table}:${change.row.id}`),
    };
  }
}
