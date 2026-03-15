# API Reference

Complete TypeScript API surface for minisync.

---

## Client

### `createDrizzleSyncClient(options)` ✨ recommended

High-level client builder. Derives table names from your Drizzle schema and automatically installs sync triggers.

```ts
const sync = await createDrizzleSyncClient(options: CreateDrizzleSyncClientOptions): Promise<SyncClient>
```

**`CreateDrizzleSyncClientOptions`**

| field | type | default | description |
|-------|------|---------|-------------|
| `db` | `AsyncDatabase \| Database` | — | **Required.** Accepts a raw Bun `Database` or an `AsyncDatabase`. |
| `backend` | `SyncBackend` | — | **Required.** Server backend (e.g. `HttpSyncBackend`). |
| `userId` | `string` | — | **Required.** Authenticated user id. |
| `schema` | `SQLiteTable[]` | — | **Required.** Drizzle table definitions to sync. |
| `autoInstall` | `boolean` | `true` | Run `installSync` to create metadata tables and triggers. |
| `intervalMs` | `number` | — | Sync interval in milliseconds. Omit to disable automatic background sync. |
| `autoStart` | `boolean` | — | Call `start()` immediately. Requires `intervalMs`. |
| `batchSize` | `number` | `100` | Max changes per push/pull request. |
| `onSyncStart` | `(e) => void` | — | Called at the start of each `syncNow()`. |
| `onSyncSuccess` | `(e) => void` | — | Called after a successful sync. |
| `onConflict` | `(e) => void` | — | Called when a remote change loses a LWW conflict. |
| `onError` | `(e) => void` | — | Called when a sync error occurs. |

---

### `createSyncClient(options)`

Low-level client. Use when you need direct control over table names and setup.

```ts
const client = createSyncClient(options: SyncClientOptions): SyncClient
```

**`SyncClientOptions`**

| field | type | default | description |
|-------|------|---------|-------------|
| `db` | `AsyncDatabase` | — | **Required.** |
| `backend` | `SyncBackend` | — | **Required.** |
| `userId` | `string` | — | **Required.** |
| `tables` | `string[]` | — | **Required.** List of table names to sync. |
| `intervalMs` | `number` | — | Background sync interval. |
| `autoStart` | `boolean` | — | Start immediately. |
| `batchSize` | `number` | `100` | |
| `onSyncStart` | `(e) => void` | — | |
| `onSyncSuccess` | `(e) => void` | — | |
| `onConflict` | `(e) => void` | — | |
| `onError` | `(e) => void` | — | |

---

### `SyncClient` methods

| method | description |
|--------|-------------|
| `syncNow()` | Push local changes, then pull remote changes. Returns `{ pushed, pulled }`. |
| `push()` | Push queued local changes only. Returns number of accepted changes. |
| `pull()` | Pull remote changes only. Returns number of applied changes. |
| `start()` | Initialise state tables and (if `intervalMs` is set) start background sync. |
| `stop()` | Stop the background sync interval. |

---

## Server

### `createSyncRouteHandlers(options)` ✨ recommended for Next.js / Remix

Returns `{ POST }` for use as a route handler. The URL path suffix (`/push` or `/pull`) determines the action.

```ts
export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: async (request) => ({ userId: "..." }) // or null for 401
});
```

---

### `handleSyncRequest(request, options)`

Single-request variant of the above. Useful for custom routing.

```ts
const response = await handleSyncRequest(request, { backend, resolveIdentity });
```

---

### `createSyncServer(options)`

Returns a Hono app with `/push` and `/pull` routes. Use for standalone sync servers.

```ts
const app = createSyncServer({ backend, auth });
export default app;
```

---

## Setup

### `installSync(options)`

Creates `_sync_queue`, `_sync_state`, and per-table triggers.

```ts
await installSync({ db, tables: [syncTable("notes", { columns: ["id", "user_id", "title"] })] });
```

### `syncTable(table, options?)`

Build a `SyncTableConfig` from a table name or Drizzle `SQLiteTable`. Automatically infers `id`, `user_id`, and `deleted_at` column conventions.

```ts
const config = syncTable(notes);           // from Drizzle table
const config = syncTable("notes", {        // from name + explicit columns
  columns: ["id", "user_id", "title"],
});
```

### `setupSync(db, tables)`

Convenience wrapper: equivalent to `installSync` but accepts a plain array of `SetupTable` objects.

---

## Backends

### `SqliteSyncBackend`

```ts
new SqliteSyncBackend({ db: AsyncDatabase, changesTable?: string })
```

`init()` is called automatically on first `pull` or `push`.

### `PostgresSyncBackend`

```ts
new PostgresSyncBackend({ sql: SqlExecutor, changesTable?: string })
```

### `SupabaseSyncBackend`

```ts
new SupabaseSyncBackend({ client, pullRpc?, pushRpc? })
```

### `MemorySyncBackend`

```ts
new MemorySyncBackend()
```

### `supabaseSqlSetup(options?)`

Returns SQL string to run once in Supabase to create the RPC functions and table.

---

## HTTP client

### `HttpSyncBackend`

```ts
new HttpSyncBackend({
  baseUrl: string,    // e.g. "https://api.example.com/api/sync"
  headers?: HeadersInit,
  fetch?: typeof fetch,  // injectable for testing
})
```

---

## Auth adapters (Hono server)

| export | description |
|--------|-------------|
| `jwtClaimsAuth(options?)` | JWT Bearer — extracts userId from sub/userId claims |
| `clerkAuth(options?)` | Clerk session token |
| `bearerTokenAuth(options)` | Custom token resolver |
| `authJsAuth(options)` | Auth.js — via `getSession` callback |
| `chainAuth(...adapters)` | Try adapters in order |
| `customAuth(adapter)` | Identity wrapper |

## Auth helpers (route handlers)

| export | description |
|--------|-------------|
| `resolveAuthJsIdentity(options)` | Calls `auth()` and maps `session.user.id` to `userId` |

---

## Utilities

### `bunSqliteAdapter(db)` — Bun

Wraps a Bun `Database` into the `AsyncDatabase` interface.

```ts
import { Database } from "bun:sqlite";
import { bunSqliteAdapter } from "minisync";

const db = bunSqliteAdapter(new Database("app.db"));
```

### `betterSqlite3Adapter(db)` — Node.js (better-sqlite3)

```ts
import Database from "better-sqlite3";
import { betterSqlite3Adapter } from "minisync";

const db = betterSqlite3Adapter(new Database("app.db"));
```

### `nodeSqliteAdapter(db)` — Node.js 22.5+ (node:sqlite built-in)

```ts
import { DatabaseSync } from "node:sqlite";
import { nodeSqliteAdapter } from "minisync";

const db = nodeSqliteAdapter(new DatabaseSync("app.db"));
```

### `denoSqliteAdapter(db)` — Deno (@db/sqlite)

```ts
import { Database } from "@db/sqlite";
import { denoSqliteAdapter } from "minisync";

const db = denoSqliteAdapter(new Database("app.db"));
```

### `libsqlAdapter(client)` — libsql / Turso

```ts
import { createClient } from "@libsql/client";
import { libsqlAdapter } from "minisync";

const db = libsqlAdapter(createClient({ url: "file:app.db" }));
// or: createClient({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_TOKEN! })
```

See [docs/adapters.md](./adapters.md) for full details on each adapter.

### `inspectQueue(db)`

Returns all pending entries in `_sync_queue`. Useful for debugging.

### `inspectState(db)`

Returns all entries in `_sync_state` as a `Record<string, string>`.

---

## Core types

```ts
interface AsyncDatabase {
  exec(sql: string, params?: unknown[]): Promise<void> | void;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> | T[];
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> | T | null;
  transaction<T>(fn: (tx: AsyncDatabase) => Promise<T> | T): Promise<T> | T;
}

interface SyncBackend {
  pullChanges(request: PullRequest): Promise<PullResponse>;
  pushChanges(request: PushRequest): Promise<PushResponse>;
}

interface SyncRow {
  id: string;
  userId: string;
  data: Record<string, JsonValue>;
  hlc: string;
  deleted: boolean;
}

interface SyncChange {
  table: string;
  op: "upsert" | "delete";
  row: SyncRow;
}
```
