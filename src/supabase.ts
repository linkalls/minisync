import type { PullRequest, PullResponse, PushRequest, PushResponse, SyncBackend } from "./types";

export interface SupabaseLikeClient {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }>;
}

export interface SupabaseSyncBackendOptions {
  client: SupabaseLikeClient;
  pullRpc?: string;
  pushRpc?: string;
}

export class SupabaseSyncBackend implements SyncBackend {
  private readonly pullRpc: string;
  private readonly pushRpc: string;

  constructor(private readonly options: SupabaseSyncBackendOptions) {
    this.pullRpc = options.pullRpc ?? "minisync_pull";
    this.pushRpc = options.pushRpc ?? "minisync_push";
  }

  async pullChanges(request: PullRequest): Promise<PullResponse> {
    const { data, error } = await this.options.client.rpc<PullResponse>(this.pullRpc, {
      p_user_id: request.userId,
      p_checkpoint: request.checkpoint ?? null,
      p_tables: request.tables ?? null,
    });
    if (error) throw new Error(`Supabase pull failed: ${error.message}`);
    return data ?? { checkpoint: request.checkpoint ?? "", changes: [] };
  }

  async pushChanges(request: PushRequest): Promise<PushResponse> {
    const { data, error } = await this.options.client.rpc<PushResponse>(this.pushRpc, {
      p_user_id: request.userId,
      p_changes: request.changes,
    });
    if (error) throw new Error(`Supabase push failed: ${error.message}`);
    return data ?? { accepted: 0, checkpoint: request.changes.at(-1)?.row.hlc ?? "", acknowledgedIds: [] };
  }
}

export function supabaseSqlSetup(options?: { schema?: string; changesTable?: string }) {
  const schema = options?.schema ?? "public";
  const changesTable = options?.changesTable ?? "_remote_changes";
  return `
create table if not exists ${schema}.${changesTable} (
  checkpoint text primary key,
  table_name text not null,
  op text not null,
  row_id text not null,
  user_id text not null,
  hlc text not null,
  deleted boolean not null default false,
  payload jsonb not null
);

create or replace function ${schema}.minisync_pull(p_user_id text, p_checkpoint text default null, p_tables text[] default null)
returns jsonb
language sql
as $$
  with rows as (
    select checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload
    from ${schema}.${changesTable}
    where user_id = p_user_id
      and (p_checkpoint is null or checkpoint > p_checkpoint)
      and (p_tables is null or table_name = any(p_tables))
    order by checkpoint asc
  )
  select jsonb_build_object(
    'checkpoint', coalesce((select checkpoint from rows order by checkpoint desc limit 1), coalesce(p_checkpoint, '')),
    'changes', coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name,
      'op', op,
      'row', jsonb_build_object(
        'id', row_id,
        'userId', user_id,
        'data', payload,
        'hlc', hlc,
        'deleted', deleted
      )
    )), '[]'::jsonb)
  )
  from rows;
$$;

create or replace function ${schema}.minisync_push(p_user_id text, p_changes jsonb)
returns jsonb
language plpgsql
as $$
declare
  item jsonb;
  last_checkpoint text := '';
  ack_ids text[] := '{}';
  accepted_count int := 0;
begin
  for item in select * from jsonb_array_elements(p_changes)
  loop
    if item #>> '{row,userId}' <> p_user_id then
      raise exception 'ownership mismatch';
    end if;

    insert into ${schema}.${changesTable} (checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload)
    values (
      item #>> '{row,hlc}',
      item ->> 'table',
      item ->> 'op',
      item #>> '{row,id}',
      item #>> '{row,userId}',
      item #>> '{row,hlc}',
      coalesce((item #>> '{row,deleted}')::boolean, false),
      coalesce(item #> '{row,data}', '{}'::jsonb)
    )
    on conflict (checkpoint) do update set
      table_name = excluded.table_name,
      op = excluded.op,
      row_id = excluded.row_id,
      user_id = excluded.user_id,
      hlc = excluded.hlc,
      deleted = excluded.deleted,
      payload = excluded.payload;

    last_checkpoint := item #>> '{row,hlc}';
    ack_ids := array_append(ack_ids, (item ->> 'table') || ':' || (item #>> '{row,id}'));
    accepted_count := accepted_count + 1;
  end loop;

  return jsonb_build_object(
    'accepted', accepted_count,
    'checkpoint', last_checkpoint,
    'acknowledgedIds', ack_ids
  );
end;
$$;
`;
}
