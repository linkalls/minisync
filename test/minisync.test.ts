import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { compareHlc, createSyncClient, MemorySyncBackend, metadataSql, nextHlc, resolveLww, triggerSql } from "../src";

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
  test("tracks local writes and pushes them", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)");
    for (const sql of metadataSql()) db.exec(sql);
    for (const sql of triggerSql("notes", ["id", "user_id", "title"])) db.exec(sql);

    const backend = new MemorySyncBackend();
    const client = createSyncClient({ db, backend, userId: "u1", tables: ["notes"] });
    client.init();

    db.query("INSERT INTO notes (id, user_id, title) VALUES (?1, ?2, ?3)").run("n1", "u1", "hello");

    const queued = db.query("SELECT COUNT(*) as count FROM _sync_queue").get() as { count: number };
    expect(queued.count).toBe(1);

    const result = await client.syncNow();
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);

    const queueAfter = db.query("SELECT COUNT(*) as count FROM _sync_queue").get() as { count: number };
    expect(queueAfter.count).toBe(0);

    const pulled = await backend.pullChanges({ userId: "u1", tables: ["notes"] });
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0]?.row.data.title).toBe("hello");
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
