import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  compareHlc,
  createSyncClient,
  createSyncServer,
  defineDrizzleSyncTable,
  HttpSyncBackend,
  inspectQueue,
  inspectState,
  installSync,
  MemorySyncBackend,
  metadataSql,
  nextHlc,
  resolveLww,
  setupSync,
  SqliteSyncBackend,
  syncTable,
  triggerSql,
  bunSqliteAdapter,
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

describe("schema helpers", () => {
  test("syncTable infers conventions from drizzle table", () => {
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      userId: text("user_id").notNull(),
      title: text("title").notNull(),
      deletedAt: text("deleted_at"),
    });

    const table = syncTable(notes);
    expect(table.name).toBe("notes");
    expect(table.columns).toContain("id");
    expect(table.userIdColumn).toBe("user_id");
    expect(table.deletedAtColumn).toBe("deleted_at");
  });

  test("installSync uses high-level table configs", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    const db = bunSqliteAdapter(rawDb);
    await installSync({ db, tables: [syncTable("notes", { columns: ["id", "user_id", "title"] })] });
    rawDb.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");
    expect(await inspectQueue(db)).toHaveLength(1);
  });
});

describe("SQLite queue + sync client", () => {
  test("setupSync installs metadata and triggers", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    const db = bunSqliteAdapter(rawDb);
    await setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);

    rawDb.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const queue = await inspectQueue(db);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.table_name).toBe("notes");
  });

  test("supports soft delete trigger mode", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, deleted_at TEXT)");
    const db = bunSqliteAdapter(rawDb);
    await setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title", "deleted_at"], deletedAtColumn: "deleted_at" }]);

    rawDb.query("INSERT INTO notes (id, user_id, title, deleted_at) VALUES (?1, ?2, ?3, NULL)").run("n1", "u1", "hello");
    rawDb.query("UPDATE notes SET deleted_at = ?2 WHERE id = ?1").run("n1", "2026-03-13T14:00:00Z");

    const queue = await inspectQueue(db);
    expect(queue.some((entry) => entry.op === "delete")).toBe(true);
  });

  test("tracks local writes and pushes them", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    for (const sql of metadataSql()) rawDb.exec(sql);
    for (const sql of triggerSql("notes", ["id", "user_id", "title"])) rawDb.exec(sql);
    const db = bunSqliteAdapter(rawDb);

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
    await client.start();

    rawDb.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const result = await client.syncNow();
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(events).toEqual(["start", "success"]);
    const state = await inspectState(db);
    expect(state.checkpoint.length).toBeGreaterThan(0);
  });

  test("releases queue lock and increments attempts on push failure", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    const db = bunSqliteAdapter(rawDb);
    await setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);
    rawDb.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

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
    await client.start();

    await expect(client.push()).rejects.toThrow("boom");
    const row = rawDb.query("SELECT attempts, locked, last_error FROM _sync_queue LIMIT 1").get() as {
      attempts: number;
      locked: number;
      last_error: string;
    };
    expect(row.attempts).toBe(1);
    expect(row.locked).toBe(0);
    expect(row.last_error).toContain("boom");
  });

  test("applies pulled rows into local sqlite", async () => {
    const rawLocalDb = new Database(":memory:");
    rawLocalDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    const localDb = bunSqliteAdapter(rawLocalDb);
    await setupSync(localDb, [{ name: "notes", columns: ["id", "user_id", "title"] }]);

    const remoteDb = new Database(":memory:");
    const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(remoteDb) });
    await backend.init();

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
    await client.start();
    const pulled = await client.pull();
    expect(pulled).toBe(1);

    const row = rawLocalDb.query("SELECT id, user_id, title FROM notes WHERE id = ?1").get("n2") as { id: string; user_id: string; title: string } | null;
    expect(row).toEqual({ id: "n2", user_id: "u1", title: "remote" });
  });

  test("drizzle helper exposes better DX", () => {
    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      userId: text("user_id").notNull(),
      title: text("title").notNull(),
    });

    const table = defineDrizzleSyncTable(notes);
    expect(table.name).toBe("notes");
    expect(table.columns).toEqual(["id", "user_id", "title"]);
  });

  test("HTTP backend can talk to Hono sync server with auth", async () => {
    const backend = new MemorySyncBackend();
    const app = createSyncServer({
      backend,
      auth(c) {
        const token = c.req.header("authorization");
        if (!token) return null;
        return { userId: token.replace(/^Bearer\s+/i, "") };
      },
    });
    const http = new HttpSyncBackend({
      baseUrl: "http://sync.test",
      headers: { authorization: "Bearer u1" },
      fetch: ((input: any, init: any) => app.request(input, init)) as any,
    });

    const pushed = await http.pushChanges({
      userId: "wrong-user",
      changes: [
        {
          table: "notes",
          op: "upsert",
          row: { id: "n1", userId: "u1", data: { id: "n1", user_id: "u1", title: "hello" }, hlc: nextHlc({ nowMs: 1, nodeId: "c" }), deleted: false },
        },
      ],
    });
    expect(pushed.accepted).toBe(1);
    expect(pushed.acknowledgedIds).toEqual(["notes:n1"]);

    const pulled = await http.pullChanges({ userId: "wrong-user", tables: ["notes"] });
    expect(pulled.changes).toHaveLength(1);
  });

  test("server rejects unauthenticated requests when auth is enabled", async () => {
    const app = createSyncServer({ backend: new MemorySyncBackend(), auth: () => null });
    const http = new HttpSyncBackend({
      baseUrl: "http://sync.test",
      fetch: ((input: any, init: any) => app.request(input, init)) as any,
    });

    await expect(http.pullChanges({ userId: "u1", tables: ["notes"] })).rejects.toThrow("401");
  });

  test("dead-letters queue rows after repeated failures", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    const db = bunSqliteAdapter(rawDb);
    await setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);
    rawDb.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

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
    await client.start();

    for (let i = 0; i < 10; i++) {
      await expect(client.push()).rejects.toThrow("boom");
    }

    const row = rawDb.query("SELECT attempts, dead_lettered FROM _sync_queue LIMIT 1").get() as { attempts: number; dead_lettered: number };
    expect(row.attempts).toBe(10);
    expect(row.dead_lettered).toBe(1);
  });

  test("pulls data in batches and respects limits", async () => {
    const rawLocalDb = new Database(":memory:");
    rawLocalDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    const localDb = bunSqliteAdapter(rawLocalDb);
    await setupSync(localDb, [{ name: "notes", columns: ["id", "user_id", "title"] }]);

    const remoteDb = new Database(":memory:");
    const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(remoteDb) });
    await backend.init();

    const changes = Array.from({ length: 5 }, (_, i) => ({
      table: "notes",
      op: "upsert" as const,
      row: {
        id: `n${i}`,
        userId: "u1",
        data: { id: `n${i}`, user_id: "u1", title: `title ${i}` },
        hlc: nextHlc({ nowMs: i, nodeId: "srv" }),
        deleted: false,
      },
    }));

    await backend.pushChanges({
      userId: "u1",
      changes,
    });

    const client = createSyncClient({
      db: localDb,
      backend,
      userId: "u1",
      tables: ["notes"],
      batchSize: 2, // Pagination by 2
    });

    const pulled = await client.pull();
    expect(pulled).toBe(5);

    const rowCount = rawLocalDb.query("SELECT COUNT(*) as count FROM notes").get() as { count: number };
    expect(rowCount.count).toBe(5);
  });

  test("pushes data in batches", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    for (const sql of metadataSql()) rawDb.exec(sql);
    for (const sql of triggerSql("notes", ["id", "user_id", "title"])) rawDb.exec(sql);
    const db = bunSqliteAdapter(rawDb);

    for (let i = 0; i < 5; i++) {
      rawDb.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run(`n${i}`, "u1", `hello ${i}`);
    }

    let pushRequests = 0;
    const backend = new MemorySyncBackend();
    const originalPush = backend.pushChanges.bind(backend);
    backend.pushChanges = async (req) => {
      pushRequests++;
      return originalPush(req);
    };

    const client = createSyncClient({
      db,
      backend,
      userId: "u1",
      tables: ["notes"],
      batchSize: 2, // Batch push
    });

    const pushed = await client.push();
    expect(pushed).toBe(5);
    expect(pushRequests).toBe(3); // 2 + 2 + 1 = 5
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
