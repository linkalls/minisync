import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  compareHlc,
  createSyncClient,
  defineDrizzleSyncTable,
  inspectQueue,
  inspectState,
  MemorySyncBackend,
  metadataSql,
  nextHlc,
  resolveLww,
  setupSync,
  SqliteSyncBackend,
  triggerSql,
} from "../src";

describe("HLC", () => {
  test("monotonic even when wall clock does not advance", () => {
    const first = nextHlc({ nowMs: 1000, nodeId: "a" });
    const second = nextHlc({ nowMs: 1000, last: first, nodeId: "a" });
    expect(compareHlc(second, first)).toBeGreaterThan(0);
  });
});

describe("LWW", () => {
  test("picks row with newer hlc", () => {
    const local = { id: "1", userId: "u1", data: { title: "old" }, hlc: "0000000001000-000000-a", deleted: false };
    const remote = { id: "1", userId: "u1", data: { title: "new" }, hlc: "0000000001000-000001-a", deleted: false };
    expect(resolveLww(local, remote)).toEqual(remote);
  });
});

describe("SQLite queue + sync client", () => {
  test("setupSync installs metadata and triggers", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);

    db.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const queue = inspectQueue(db);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.table_name).toBe("notes");
  });

  test("supports soft delete trigger mode", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, deleted_at TEXT)");
    setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title", "deleted_at"], deletedAtColumn: "deleted_at" }]);

    db.query("INSERT INTO notes (id, user_id, title, deleted_at) VALUES (?1, ?2, ?3, NULL)").run("n1", "u1", "hello");
    db.query("UPDATE notes SET deleted_at = ?2 WHERE id = ?1").run("n1", "2026-03-13T14:00:00Z");

    const queue = inspectQueue(db);
    expect(queue).toHaveLength(3);
    expect(queue.some((entry) => entry.op === "delete")).toBe(true);
  });

  test("tracks local writes and pushes them", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    for (const sql of metadataSql()) db.exec(sql);
    for (const sql of triggerSql("notes", ["id", "user_id", "title"])) db.exec(sql);

    const events: string[] = [];
    const backend = new MemorySyncBackend();
    const client = createSyncClient({
      db,
      backend,
      userId: "u1",
      tables: ["notes"],
      onSyncStart: () => events.push("start"),
      onSyncSuccess: () => events.push("success"),
    });
    client.start();

    db.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const queued = db.query("SELECT COUNT(*) as count FROM _sync_queue").get() as { count: number };
    expect(queued.count).toBe(1);

    const result = await client.syncNow();
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(events).toEqual(["start", "success"]);

    const queueAfter = db.query("SELECT COUNT(*) as count FROM _sync_queue").get() as { count: number };
    expect(queueAfter.count).toBe(0);
    expect(inspectState(db).checkpoint.length).toBeGreaterThan(0);

    const pulled = await backend.pullChanges({ userId: "u1", tables: ["notes"] });
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0]?.row.data.title).toBe("hello");
  });

  test("releases queue lock and increments attempts on push failure", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);
    db.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const client = createSyncClient({
      db,
      backend: {
        async pullChanges() {
          return { checkpoint: "", changes: [] };
        },
        async pushChanges() {
          throw new Error("boom");
        },
      },
      userId: "u1",
      tables: ["notes"],
    });
    client.start();

    await expect(client.push()).rejects.toThrow("boom");
    const row = db.query("SELECT attempts, locked, last_error FROM _sync_queue LIMIT 1").get() as {
      attempts: number;
      locked: number;
      last_error: string;
    };
    expect(row.attempts).toBe(1);
    expect(row.locked).toBe(0);
    expect(row.last_error).toContain("boom");
  });

  test("applies pulled rows into local sqlite", async () => {
    const localDb = new Database(":memory:");
    localDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    setupSync(localDb, [{ name: "notes", columns: ["id", "user_id", "title"] }]);

    const remoteDb = new Database(":memory:");
    const backend = new SqliteSyncBackend({ db: remoteDb });
    backend.init();

    await backend.pushChanges({
      userId: "u1",
      changes: [
        {
          table: "notes",
          op: "upsert",
          row: { id: "n2", userId: "u1", data: { id: "n2", user_id: "u1", title: "remote" }, hlc: nextHlc({ nowMs: 10, nodeId: "srv" }), deleted: false },
        },
      ],
    });

    const client = createSyncClient({ db: localDb, backend, userId: "u1", tables: ["notes"] });
    client.start();
    const pulled = await client.pull();
    expect(pulled).toBe(1);

    const row = localDb.query("SELECT id, user_id, title FROM notes WHERE id = ?1").get("n2") as { id: string; user_id: string; title: string } | null;
    expect(row).toEqual({ id: "n2", user_id: "u1", title: "remote" });
  });

  test("drizzle helper exposes table name for setup", () => {
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      userId: text("user_id").notNull(),
      title: text("title").notNull(),
    });

    const syncTable = defineDrizzleSyncTable(notes, ["id", "user_id", "title"]);
    expect(syncTable.name).toBe("notes");
    expect(syncTable.columns).toEqual(["id", "user_id", "title"]);
  });

  test("rejects ownership mismatch", async () => {
    const backend = new MemorySyncBackend();
    await expect(
      backend.pushChanges({
        userId: "u1",
        changes: [
          {
            table: "notes",
            op: "upsert",
            row: { id: "n1", userId: "u2", data: { title: "bad" }, hlc: nextHlc({ nowMs: 1 }), deleted: false },
          },
        ],
      }),
    ).rejects.toThrow("ownership mismatch");
  });
});
