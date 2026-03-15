import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  betterSqlite3Adapter,
  denoSqliteAdapter,
  libsqlAdapter,
  nodeSqliteAdapter,
  setupSync,
  createSyncClient,
  MemorySyncBackend,
  nextHlc,
} from "../src";
import type { LibsqlClient, LibsqlTransaction, SyncSqliteDatabase } from "../src";

// ─────────────────────────────────────────────────────────────────────────────
// Bun's Database satisfies SyncSqliteDatabase (exec + prepare), so we use it
// as a stand-in for better-sqlite3, node:sqlite, and Deno @db/sqlite in tests.
// ─────────────────────────────────────────────────────────────────────────────

function makeBunAsSync(): SyncSqliteDatabase {
  const rawDb = new Database(":memory:");
  return {
    exec(sql) {
      rawDb.exec(sql);
    },
    prepare(sql) {
      const stmt = rawDb.prepare(sql);
      return {
        run: (...params) => stmt.run(...(params as any[])),
        all: (...params) => stmt.all(...(params as any[])) as unknown[],
        get: (...params) => stmt.get(...(params as any[])) as unknown,
      };
    },
  };
}

describe("betterSqlite3Adapter / nodeSqliteAdapter / denoSqliteAdapter", () => {
  test("exec and query without params", async () => {
    const db = betterSqlite3Adapter(makeBunAsSync());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
    await db.exec("INSERT INTO t VALUES ('a', 'hello')");
    const rows = await db.query<{ id: string; v: string }>("SELECT * FROM t");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "a", v: "hello" });
  });

  test("exec with ?1 positional params", async () => {
    const db = nodeSqliteAdapter(makeBunAsSync());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
    await db.exec("INSERT INTO t VALUES (?1, ?2)", ["x", "world"]);
    const row = await db.get<{ v: string }>("SELECT v FROM t WHERE id = ?1", ["x"]);
    expect(row?.v).toBe("world");
  });

  test("query with params returns multiple rows", async () => {
    const driver = makeBunAsSync();
    const db = denoSqliteAdapter(driver);
    await db.exec("CREATE TABLE t (n INTEGER)");
    await db.exec("INSERT INTO t VALUES (?1)", [1]);
    await db.exec("INSERT INTO t VALUES (?1)", [2]);
    await db.exec("INSERT INTO t VALUES (?1)", [3]);
    const rows = await db.query<{ n: number }>("SELECT n FROM t WHERE n > ?1 ORDER BY n", [1]);
    expect(rows.map((r) => r.n)).toEqual([2, 3]);
  });

  test("get returns null for no match", async () => {
    const db = betterSqlite3Adapter(makeBunAsSync());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    const row = await db.get("SELECT * FROM t WHERE id = ?1", ["missing"]);
    expect(row).toBeNull();
  });

  test("transaction commits on success", async () => {
    const db = betterSqlite3Adapter(makeBunAsSync());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    await db.transaction(async (tx) => {
      await tx.exec("INSERT INTO t VALUES (?1)", ["a"]);
      await tx.exec("INSERT INTO t VALUES (?1)", ["b"]);
    });
    const rows = await db.query("SELECT * FROM t ORDER BY id");
    expect(rows).toHaveLength(2);
  });

  test("transaction rolls back on error", async () => {
    const db = nodeSqliteAdapter(makeBunAsSync());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    await db.exec("INSERT INTO t VALUES (?1)", ["existing"]);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("INSERT INTO t VALUES (?1)", ["new"]);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const rows = await db.query("SELECT * FROM t");
    expect(rows).toHaveLength(1); // only the pre-existing row
  });

  test("works end-to-end with setupSync and createSyncClient", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");

    // Wrap Bun's Database via the betterSqlite3Adapter path (SyncSqliteDatabase)
    const driver: SyncSqliteDatabase = {
      exec: (sql) => rawDb.exec(sql),
      prepare: (sql) => {
        const s = rawDb.prepare(sql);
        return {
          run: (...p) => s.run(...(p as any[])),
          all: (...p) => s.all(...(p as any[])) as unknown[],
          get: (...p) => s.get(...(p as any[])) as unknown,
        };
      },
    };
    const db = betterSqlite3Adapter(driver);

    await setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);
    rawDb.prepare("INSERT INTO notes VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const backend = new MemorySyncBackend();
    const client = createSyncClient({ db, backend, userId: "u1", tables: ["notes"] });
    await client.start();
    const result = await client.syncNow();
    expect(result.pushed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// libsql adapter — tested with a mock client (no real network/file needed)
// ─────────────────────────────────────────────────────────────────────────────

function makeLibsqlMock(): LibsqlClient {
  // Minimal in-memory "libsql" client backed by a Bun Database.
  const rawDb = new Database(":memory:");

  async function execute(opts: { sql: string; args?: unknown[] }) {
    const args = opts.args ?? [];
    let rows: Record<string, unknown>[];
    try {
      const stmt = rawDb.prepare(opts.sql);
      rows = stmt.all(...(args as any[])) as Record<string, unknown>[];
    } catch {
      rows = [];
      rawDb.prepare(opts.sql).run(...(args as any[]));
    }
    return { rows };
  }

  function makeTransaction(): LibsqlTransaction {
    rawDb.exec("BEGIN");
    const committed = { done: false };
    return {
      execute: async (opts) => {
        if (committed.done) throw new Error("Transaction already closed");
        const stmt = rawDb.prepare(opts.sql);
        const rows = stmt.all(...((opts.args ?? []) as any[])) as Record<string, unknown>[];
        return { rows };
      },
      commit: async () => {
        committed.done = true;
        rawDb.exec("COMMIT");
      },
      rollback: async () => {
        committed.done = true;
        rawDb.exec("ROLLBACK");
      },
    };
  }

  return {
    execute,
    transaction: async (_mode?) => makeTransaction(),
  };
}

describe("libsqlAdapter", () => {
  test("exec and query", async () => {
    const db = libsqlAdapter(makeLibsqlMock());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
    await db.exec("INSERT INTO t VALUES (?1, ?2)", ["a", "hello"]);
    const rows = await db.query<{ id: string; v: string }>("SELECT * FROM t");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.v).toBe("hello");
  });

  test("get returns null for no match", async () => {
    const db = libsqlAdapter(makeLibsqlMock());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    const row = await db.get("SELECT * FROM t WHERE id = ?1", ["missing"]);
    expect(row).toBeNull();
  });

  test("transaction commits on success", async () => {
    const db = libsqlAdapter(makeLibsqlMock());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    await db.transaction(async (tx) => {
      await tx.exec("INSERT INTO t VALUES (?1)", ["a"]);
      await tx.exec("INSERT INTO t VALUES (?1)", ["b"]);
    });
    const rows = await db.query("SELECT id FROM t ORDER BY id");
    expect(rows).toHaveLength(2);
  });

  test("transaction rolls back on error", async () => {
    const db = libsqlAdapter(makeLibsqlMock());
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    await db.exec("INSERT INTO t VALUES (?1)", ["existing"]);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("INSERT INTO t VALUES (?1)", ["new"]);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const rows = await db.query("SELECT * FROM t");
    expect(rows).toHaveLength(1);
  });

  test("works end-to-end with setupSync and createSyncClient", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");

    // libsql mock backed by the same rawDb already pre-created
    const client = makeLibsqlMock();
    // Re-open so the notes table exists in the mock's internal db
    // (Simpler: share rawDb by creating mock after table creation)
    const mockClient: LibsqlClient = {
      execute: async (opts) => {
        const args = opts.args ?? [];
        const stmt = rawDb.prepare(opts.sql);
        let rows: Record<string, unknown>[];
        try {
          rows = stmt.all(...(args as any[])) as Record<string, unknown>[];
        } catch {
          rows = [];
          rawDb.prepare(opts.sql).run(...(args as any[]));
        }
        return { rows };
      },
      transaction: async (_mode?) => {
        rawDb.exec("BEGIN");
        const done = { closed: false };
        return {
          execute: async (opts) => {
            const stmt = rawDb.prepare(opts.sql);
            const rows = stmt.all(...((opts.args ?? []) as any[])) as Record<string, unknown>[];
            return { rows };
          },
          commit: async () => { done.closed = true; rawDb.exec("COMMIT"); },
          rollback: async () => { done.closed = true; rawDb.exec("ROLLBACK"); },
        };
      },
    };

    const db = libsqlAdapter(mockClient);
    await setupSync(db, [{ name: "notes", columns: ["id", "user_id", "title"] }]);
    rawDb.prepare("INSERT INTO notes VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const backend = new MemorySyncBackend();
    const syncClient = createSyncClient({ db, backend, userId: "u1", tables: ["notes"] });
    await syncClient.start();
    const { pushed } = await syncClient.syncNow();
    expect(pushed).toBe(1);

    const pulled = await backend.pullChanges({ userId: "u1", tables: ["notes"] });
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0]?.row.data).toMatchObject({ id: "n1", user_id: "u1", title: "hello" });
  });

  test("SqliteSyncBackend auto-initializes on first pull (no manual init needed)", async () => {
    const { SqliteSyncBackend } = await import("../src");
    const rawDb = new Database(":memory:");
    const backend = new SqliteSyncBackend({ db: bunSqliteAdapterFrom(rawDb) });
    // Calling pullChanges without init() should NOT throw
    const result = await backend.pullChanges({ userId: "u1" });
    expect(result.changes).toHaveLength(0);
  });
});

// Helper: minimal bun adapter inline for the last test
function bunSqliteAdapterFrom(rawDb: Database) {
  return {
    async exec(sql: string, params?: unknown[]) {
      if (params && params.length > 0) rawDb.query(sql).run(...(params as any[]));
      else rawDb.exec(sql);
    },
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      return (params?.length ? rawDb.query(sql).all(...(params as any[])) : rawDb.query(sql).all()) as T[];
    },
    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
      return ((params?.length ? rawDb.query(sql).get(...(params as any[])) : rawDb.query(sql).get()) as T) ?? null;
    },
    async transaction<T>(fn: (tx: ReturnType<typeof bunSqliteAdapterFrom>) => Promise<T>): Promise<T> {
      rawDb.exec("BEGIN TRANSACTION");
      try {
        const r = await fn(this as any);
        rawDb.exec("COMMIT");
        return r;
      } catch (e) {
        rawDb.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
