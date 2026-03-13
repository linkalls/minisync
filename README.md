# minisync

Tiny OSS local-first sync engine for SQLite-first apps.

## What it includes
- High-level schema install API: `installSync()` + `syncTable()`
- Trigger generation for `INSERT / UPDATE / DELETE`
- Optional soft-delete support via `deleted_at`
- HLC timestamps
- LWW conflict resolution
- Push / pull client orchestration via backend adapters
- Queue lock / retry state for failed pushes
- Event hooks: `onSyncStart`, `onSyncSuccess`, `onConflict`, `onError`
- SQLite backend for local/dev and integration testing
- HTTP backend adapter + Hono server helper
- Queue / state introspection helpers
- Drizzle-first helpers with inferred columns
- Bun test coverage

## Status
Usable prototype / MVP. Still not fully production-ready, but now much closer to a real app integration shape.

## Better setup API
```ts
import { Database } from "bun:sqlite";
import { installSync, syncTable } from "minisync";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

const db = new Database("app.db");

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),
});

installSync({
  db,
  tables: [syncTable(notes)],
});
```

## Client example
```ts
import { createSyncClient, HttpSyncBackend } from "minisync";

const backend = new HttpSyncBackend({
  baseUrl: "https://api.example.com/sync",
  headers: {
    authorization: `Bearer ${token}`,
  },
});

const client = createSyncClient({
  db,
  backend,
  userId: "u1",
  tables: ["notes"],
  intervalMs: 5000,
});

client.start();
await client.syncNow();
```

## Server example
```ts
import { createSyncServer, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

const db = new Database("sync.db");
const backend = new SqliteSyncBackend({ db });
backend.init();

export default createSyncServer({ backend });
```

## Run tests
```bash
bun install
bun test
```
