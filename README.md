# minisync

A local-first sync engine for SQLite apps — Drizzle-friendly, auth-agnostic, and self-hostable.

`minisync` is for apps that:
- write to a local SQLite database first
- work fully offline
- sync later when the server is reachable
- want open-source sync infrastructure instead of a hosted lock-in product

---

## Quickstart

### 1. Install

```bash
bun add minisync
```

### 2. Client

```ts
import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createDrizzleSyncClient, HttpSyncBackend } from "minisync";

// Your local database
const db = new Database("app.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    deleted_at TEXT
  )
`);

// Your Drizzle schema
const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),
});

// Pass the raw Bun Database directly — it's adapted automatically.
// Sync triggers and metadata tables are installed on first call.
const sync = await createDrizzleSyncClient({
  db,
  backend: new HttpSyncBackend({
    baseUrl: "https://api.example.com/api/sync",
    headers: { authorization: `Bearer ${yourToken}` },
  }),
  userId: currentUser.id,
  schema: [notes],
  intervalMs: 5000,   // background sync every 5 s
  autoStart: true,
});

// Trigger a manual sync at any time:
await sync.syncNow();
```

### 3. Server (Next.js App Router)

```ts
// app/api/sync/[action]/route.ts
import { auth } from "@/auth";
import { bunSqliteAdapter, createSyncRouteHandlers, resolveAuthJsIdentity, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

const rawDb = new Database("sync.db");
// SqliteSyncBackend initializes its own schema automatically — no .init() call needed.
const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(rawDb) });

export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
```

---

## Runtime support

minisync works with all major SQLite runtimes via adapter functions:

| runtime | adapter | driver |
|---------|---------|--------|
| **Bun** | `bunSqliteAdapter` | `bun:sqlite` (built-in) |
| **Node.js** | `betterSqlite3Adapter` | `better-sqlite3` |
| **Node.js 22.5+** | `nodeSqliteAdapter` | `node:sqlite` (built-in) |
| **Deno** | `denoSqliteAdapter` | `@db/sqlite` |
| **Turso / libsql** | `libsqlAdapter` | `@libsql/client` |

See [docs/adapters.md](./docs/adapters.md) for full usage examples.

---

## How it works

1. SQL triggers (installed by `createDrizzleSyncClient`) capture every insert / update / delete into a `_sync_queue` table.
2. `syncNow()` **pushes** queued local changes to the server, then **pulls** any new remote changes.
3. Conflicts are resolved with **Last-Write-Wins** using a [Hybrid Logical Clock](./docs/concepts.md#hybrid-logical-clock-hlc).
4. Remote changes are applied inside a transaction while `is_syncing = 1` to avoid re-queueing them.

---

## Backends

| backend | best for |
|---------|----------|
| `SqliteSyncBackend` | dev, testing, small self-hosted servers |
| `PostgresSyncBackend` | standard self-hosted production servers |
| `SupabaseSyncBackend` | Supabase-hosted projects |
| `MemorySyncBackend` | unit tests |
| custom `SyncBackend` | any storage layer |

See [docs/backends.md](./docs/backends.md) for details.

---

## Auth adapters

minisync ships ready-to-use auth adapters for the most common stacks:

| adapter | use case |
|---------|----------|
| `resolveAuthJsIdentity` | Next.js / Auth.js route handlers |
| `jwtClaimsAuth` | JWT Bearer tokens (Hono server) |
| `clerkAuth` | Clerk (Hono server) |
| `bearerTokenAuth` | custom token lookup (Hono server) |
| `chainAuth` | try multiple adapters in order |

See [docs/auth.md](./docs/auth.md) for details.

---

## Docs

- [Getting started](./docs/getting-started.md) — step-by-step setup guide
- [Concepts](./docs/concepts.md) — HLC, conflict resolution, sync protocol
- [Adapters](./docs/adapters.md) — Bun, Node.js, Deno, libsql/Turso
- [Backends](./docs/backends.md) — all backend options with examples
- [Auth](./docs/auth.md) — all auth adapters with examples
- [API reference](./docs/api.md) — complete TypeScript API

---

## Examples

| file | description |
|------|-------------|
| `examples/drizzle-client.ts` | Recommended client setup |
| `examples/next-authjs-route.ts` | Auth.js + Next.js App Router server |
| `examples/http-server.ts` | Standalone Hono server |
| `examples/supabase.ts` | Supabase backend |

---

## Low-level API

For advanced use cases you can compose the primitives directly:

```ts
import { Database } from "bun:sqlite";
import { bunSqliteAdapter, installSync, syncTable, createSyncClient, MemorySyncBackend } from "minisync";

const rawDb = new Database("app.db");
rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");

const db = bunSqliteAdapter(rawDb);

// 1. Install metadata tables and triggers manually
await installSync({
  db,
  tables: [syncTable("notes", { columns: ["id", "user_id", "title"] })],
});

// 2. Create the low-level client
const client = createSyncClient({
  db,
  backend: new MemorySyncBackend(),
  userId: "u1",
  tables: ["notes"],
});

await client.start();
await client.syncNow();
```

---

## Development

```bash
bun install
bun test
```

---

## License

MIT

