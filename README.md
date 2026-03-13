# minisync

Tiny OSS local-first sync engine for SQLite-first apps.

## What it includes
- Local SQLite metadata tables
- Trigger generation for `INSERT / UPDATE / DELETE`
- Optional soft-delete trigger support via `deleted_at`
- HLC timestamps
- LWW conflict resolution
- Push / pull client orchestration via backend adapters
- Queue lock / retry state for failed pushes
- Event hooks: `onSyncStart`, `onSyncSuccess`, `onConflict`, `onError`
- Local SQLite-backed backend for self-contained testing/dev
- Queue / state introspection helpers
- Drizzle helper for sync table definitions
- Bun test coverage

## Status
Usable prototype / MVP. Still missing a production-grade HTTP backend adapter and migration story.

## Quick example
```ts
import { Database } from "bun:sqlite";
import { SqliteSyncBackend, createSyncClient, setupSync } from "minisync";

const db = new Database(":memory:");
db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, deleted_at TEXT)");
setupSync(db, [
  {
    name: "notes",
    columns: ["id", "user_id", "title", "deleted_at"],
    deletedAtColumn: "deleted_at",
  },
]);

const backendDb = new Database(":memory:");
const backend = new SqliteSyncBackend({ db: backendDb });
backend.init();

const client = createSyncClient({
  db,
  backend,
  userId: "u1",
  tables: ["notes"],
  intervalMs: 5_000,
  onSyncSuccess(event) {
    console.log("synced", event);
  },
});

client.start();
await client.syncNow();
```

## Drizzle helper
```ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineDrizzleSyncTable, setupSync } from "minisync";

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
});

setupSync(db, [defineDrizzleSyncTable(notes, ["id", "user_id", "title"])]);
```

## Run tests
```bash
bun install
bun test
```
