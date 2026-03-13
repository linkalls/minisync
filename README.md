# minisync

Tiny OSS local-first sync engine prototype for SQLite-first apps.

## What it includes
- Local SQLite metadata tables
- Trigger generation for `INSERT / UPDATE / DELETE`
- HLC timestamps
- LWW conflict resolution
- Push / pull client orchestration via backend adapters
- Local SQLite-backed backend for self-contained testing/dev
- Queue / state introspection helpers
- Bun test coverage

## Status
This is an MVP scaffold, not production-ready yet.

## Quick example
```ts
import { Database } from "bun:sqlite";
import { SqliteSyncBackend, createSyncClient, setupSync } from "minisync";

const db = new Database(":memory:");
db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);

const backendDb = new Database(":memory:");
const backend = new SqliteSyncBackend({ db: backendDb });
backend.init();

const client = createSyncClient({ db, backend, userId: "u1", tables: ["notes"] });
client.start();
await client.syncNow();
```

## Run tests
```bash
bun test
```
