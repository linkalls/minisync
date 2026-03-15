# Backends

minisync ships three server-side backends and one in-memory backend for testing.

---

## SqliteSyncBackend

The simplest backend. Stores all changes in a single SQLite table. Suitable for:

- Local development
- Small-to-medium self-hosted deployments (single server)
- Integration tests

```ts
import { Database } from "bun:sqlite";
import { bunSqliteAdapter, SqliteSyncBackend } from "minisync";

const rawDb = new Database("sync.db");
const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(rawDb) });
// init() is called automatically on first use — no manual call needed.
```

### Options

| option | type | default | description |
|--------|------|---------|-------------|
| `db` | `AsyncDatabase` | — | **Required.** Database connection. Use `bunSqliteAdapter` for Bun's SQLite. |
| `changesTable` | `string` | `"_remote_changes"` | Name of the server-side changes table. |

### Schema

`SqliteSyncBackend` creates the following table automatically:

```sql
CREATE TABLE IF NOT EXISTS _remote_changes (
  checkpoint TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  op         TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  hlc        TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  payload    TEXT NOT NULL
);
```

---

## PostgresSyncBackend

A Postgres-compatible backend. Injects SQL via a `SqlExecutor` interface so you can plug in any Postgres client (node-postgres, Drizzle, Prisma raw queries, etc.).

```ts
import postgres from "postgres";
import { PostgresSyncBackend } from "minisync";

const sql = postgres(process.env.DATABASE_URL!);

const backend = new PostgresSyncBackend({
  sql: {
    query: async (text, params) => {
      const rows = await sql.unsafe(text, params as any[]);
      return { rows };
    },
  },
});

await backend.init(); // creates the _remote_changes table
```

### Options

| option | type | default | description |
|--------|------|---------|-------------|
| `sql` | `SqlExecutor` | — | **Required.** SQL executor with a `query(sql, params)` method. |
| `changesTable` | `string` | `"_remote_changes"` | Table name. |

### `SqlExecutor` interface

```ts
interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
```

Implement this to bridge your Postgres client to minisync.

---

## SupabaseSyncBackend

Uses Supabase RPC functions. The sync logic runs inside Postgres functions you install once with `supabaseSqlSetup()`.

```ts
import { createClient } from "@supabase/supabase-js";
import { SupabaseSyncBackend, supabaseSqlSetup } from "minisync";

// 1. Run the SQL setup once in your Supabase SQL editor:
console.log(supabaseSqlSetup());

// 2. Use the backend in your server route:
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
const backend = new SupabaseSyncBackend({ client: supabase });
```

### Options

| option | type | default | description |
|--------|------|---------|-------------|
| `client` | `SupabaseLikeClient` | — | **Required.** Supabase JS client (or any object with `.rpc()`). |
| `pullRpc` | `string` | `"minisync_pull"` | Name of the pull RPC function. |
| `pushRpc` | `string` | `"minisync_push"` | Name of the push RPC function. |

### `supabaseSqlSetup()`

Generates the SQL to create the changes table and the `minisync_pull` / `minisync_push` functions.

```ts
import { supabaseSqlSetup } from "minisync";

// Default: public schema, _remote_changes table
const sql = supabaseSqlSetup();

// Custom schema / table name:
const sql = supabaseSqlSetup({ schema: "sync", changesTable: "changes" });
```

Run the generated SQL once in the Supabase SQL editor or a migration.

---

## MemorySyncBackend

An in-memory backend for unit tests and local development. Does not persist data between process restarts.

```ts
import { MemorySyncBackend } from "minisync";

const backend = new MemorySyncBackend();
```

No options. No setup required.

---

## Custom backend

Implement the `SyncBackend` interface to use any storage layer:

```ts
import type { SyncBackend, PullRequest, PullResponse, PushRequest, PushResponse } from "minisync";

export class MyCustomBackend implements SyncBackend {
  async pullChanges(request: PullRequest): Promise<PullResponse> {
    // Return changes newer than request.checkpoint for request.userId
    return { checkpoint: "", changes: [], hasMore: false };
  }

  async pushChanges(request: PushRequest): Promise<PushResponse> {
    // Persist request.changes (all owned by request.userId)
    return { accepted: request.changes.length, checkpoint: "" };
  }
}
```
