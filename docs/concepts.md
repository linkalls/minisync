# Concepts

This document explains the core ideas behind minisync.

---

## Local-first architecture

minisync follows the local-first principle:

- **Reads are always instant** — data lives in a local SQLite file.
- **Writes are always instant** — written to SQLite first, queued for sync later.
- **Offline-capable** — the app works without a network connection; changes are synced when connectivity returns.
- **Server is secondary** — the server stores a log of changes; clients are the source of truth for their own data.

---

## The sync queue

When you call `installSync` (or `createDrizzleSyncClient`), minisync attaches SQL triggers to your tables. Whenever a row is inserted, updated, or deleted, a trigger fires and writes a record into `_sync_queue`:

```
_sync_queue
  seq           INTEGER  (auto-increment primary key)
  table_name    TEXT
  op            TEXT     ("upsert" | "delete")
  row_id        TEXT
  user_id       TEXT
  hlc           TEXT     (Hybrid Logical Clock timestamp)
  payload       TEXT     (JSON snapshot of the row)
  attempts      INTEGER  (retry counter)
  locked        INTEGER  (1 while an in-flight push is in progress)
  dead_lettered INTEGER  (1 after 10 failed attempts)
  last_error    TEXT
```

The queue is processed in FIFO order. Redundant entries for the same row are deduplicated before pushing.

---

## Hybrid Logical Clock (HLC)

minisync uses an HLC instead of wall-clock timestamps to order events across distributed nodes.

An HLC value looks like:

```
0001742014085000-000001-client
│              │  │      └── node id
│              │  └───────── monotonic counter
└──────────────┴───────────── wall-clock milliseconds (13 digits)
```

Properties:
- **Monotonic** — guaranteed to advance even if the wall clock doesn't.
- **Comparable** — lexicographic string comparison correctly orders events.
- **Node-aware** — node id breaks ties deterministically.

HLC values are stored in the `hlc` column of the sync queue and the `_sync_state` table.

---

## Conflict resolution

minisync uses **Last-Write-Wins (LWW)** conflict resolution at the row level.

When the same row is modified on multiple clients before a sync:

1. Each change carries an HLC timestamp.
2. When two versions of the same row arrive at the server, the one with the higher HLC wins.
3. Ties (identical HLC) are broken by row id lexicography.

```ts
// src/conflict.ts
function resolveLww(localRow: SyncRow, remoteRow: SyncRow): SyncRow {
  const order = compareHlc(localRow.hlc, remoteRow.hlc);
  if (order === 0) {
    return localRow.id >= remoteRow.id ? localRow : remoteRow;
  }
  return order > 0 ? localRow : remoteRow;
}
```

You can observe conflicts via the `onConflict` callback:

```ts
const sync = await createDrizzleSyncClient({
  // ...
  onConflict: ({ change }) => {
    console.warn("Conflict: remote change was overridden", change);
  },
});
```

---

## Sync protocol

Every sync cycle runs two phases in order:

### Push phase

1. Read all unlocked, non-dead-lettered rows from `_sync_queue`.
2. Deduplicate: if the same `table:row_id` appears multiple times, keep only the latest entry.
3. Lock the batch (`locked = 1`).
4. `POST /push` — send changes to the server.
5. On success: delete acknowledged rows from the queue, update `checkpoint`.
6. On failure: unlock rows, increment `attempts`, dead-letter after 10 failures.

### Pull phase

1. Read current `checkpoint` from `_sync_state`.
2. `POST /pull` — request changes newer than the checkpoint.
3. Apply each remote change inside a transaction with `is_syncing = 1` (suppresses triggers to avoid re-queuing).
4. Update `checkpoint`.
5. Repeat until `hasMore = false`.

---

## Ownership model

Every change carries a `userId`. The server enforces that `change.row.userId === request.userId`. This prevents users from writing each other's data.

The `userId` is set automatically from the session / auth token on the server side.

---

## Pagination and batching

Both push and pull support configurable batching via the `batchSize` option (default: 100). For large datasets this ensures:

- Pushes don't time out sending thousands of changes at once.
- Pulls paginate through server-side history until `hasMore = false`.

---

## Soft deletes

minisync supports soft deletes (marking rows as deleted with a timestamp column) as an alternative to hard deletes:

```ts
const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),   // ← soft delete column
});

const sync = await createDrizzleSyncClient({
  db,
  backend,
  userId,
  schema: [notes],
  // deletedAtColumn is inferred automatically from "deleted_at"
});
```

When `deleted_at` transitions from `NULL` to a non-null value, the sync system emits a `delete` op instead of an `upsert`.

---

## `_sync_state` table

Persistent state is stored in `_sync_state` (key/value):

| key | description |
|-----|-------------|
| `checkpoint` | Latest pulled checkpoint |
| `last_hlc` | Last HLC used when pushing |
| `is_syncing` | `"1"` while a pull transaction is in progress (suppresses triggers) |
| `row_hlc:<table>:<id>` | Per-row HLC for conflict detection |
| `row_deleted:<table>:<id>` | Per-row deleted flag for conflict detection |
