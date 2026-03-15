# Getting Started with minisync

minisync is a local-first sync engine for SQLite apps. Data is written locally first, works offline, and syncs with a server when connectivity is available.

---

## Prerequisites

- [Bun](https://bun.sh) runtime (used for SQLite and the test suite)
- A SQLite database on the client side
- A server-side sync endpoint (covered below)

---

## Installation

```bash
bun add minisync
```

---

## Quickstart: 5-minute setup

### 1. Define your Drizzle schema

```ts
// schema.ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),
});
```

### 2. Create the client-side database and start syncing

```ts
// sync.ts  (client — runs in your app)
import { Database } from "bun:sqlite";
import { createDrizzleSyncClient, HttpSyncBackend } from "minisync";
import { notes } from "./schema";

// Create (or open) your local database.
const db = new Database("app.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    deleted_at TEXT
  )
`);

// createDrizzleSyncClient accepts either a raw Bun Database or an AsyncDatabase.
// It automatically installs the sync metadata tables and triggers.
const sync = await createDrizzleSyncClient({
  db,                           // raw Bun Database — auto-adapted
  backend: new HttpSyncBackend({
    baseUrl: "https://api.example.com/api/sync",
    headers: { authorization: `Bearer ${yourToken}` },
  }),
  userId: currentUser.id,
  schema: [notes],
  intervalMs: 5000,             // sync every 5 seconds
  autoStart: true,              // start the interval automatically
});

// Trigger a manual sync at any time:
await sync.syncNow();

// Stop background sync when you don't need it:
sync.stop();
```

### 3. Add the sync endpoint to your server

#### Next.js (App Router) — recommended

```ts
// app/api/sync/[action]/route.ts
import { auth } from "@/auth";
import { bunSqliteAdapter, createSyncRouteHandlers, resolveAuthJsIdentity, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

const rawDb = new Database("sync.db");
// SqliteSyncBackend initializes its schema lazily — no manual .init() needed.
const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(rawDb) });

export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
```

#### Hono (standalone server)

```ts
// server.ts
import { Database } from "bun:sqlite";
import { bunSqliteAdapter, createSyncServer, SqliteSyncBackend, jwtClaimsAuth } from "minisync";

const rawDb = new Database("sync.db");
const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(rawDb) });

const app = createSyncServer({
  backend,
  auth: jwtClaimsAuth(), // reads sub / userId claim from Bearer JWT
});

export default app;
```

---

## What happens under the hood?

1. When you write to your local SQLite table, a SQL trigger fires and enqueues the change in `_sync_queue`.
2. On each sync cycle, `syncNow()` pushes queued local changes to the server and pulls any new remote changes.
3. Conflicts are resolved with [Last-Write-Wins](./concepts.md#conflict-resolution) using a Hybrid Logical Clock (HLC).
4. Remote changes are applied directly to your local table inside a transaction while `is_syncing = 1` to suppress the triggers.

---

## Next steps

- [Concepts](./concepts.md) — HLC, conflict resolution, sync protocol
- [Backends](./backends.md) — SQLite, Postgres, Supabase
- [Auth](./auth.md) — Auth.js, Clerk, JWT, custom
- [API Reference](./api.md) — full type reference
