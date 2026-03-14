import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createDrizzleSyncClient, inspectQueue, MemorySyncBackend, bunSqliteAdapter } from "../src";

describe("drizzle sync builder", () => {
  test("auto installs sync metadata and derives table names", async () => {
    const rawDb = new Database(":memory:");
    rawDb.exec("create table notes (id text primary key, user_id text not null, title text not null, deleted_at text)");
    const db = bunSqliteAdapter(rawDb);

    const notes = sqliteTable("notes", {
      id: text("id").primaryKey(),
      userId: text("user_id").notNull(),
      title: text("title").notNull(),
      deletedAt: text("deleted_at"),
    });

    const client = await createDrizzleSyncClient({
      db,
      backend: new MemorySyncBackend(),
      userId: "u1",
      schema: [notes],
    });

    rawDb.query("insert into notes (id, user_id, title, deleted_at) values (?1, ?2, ?3, NULL)").run("n1", "u1", "hello");
    expect(await inspectQueue(db)).toHaveLength(1);

    const result = await client.syncNow();
    expect(result.pushed).toBe(1);
  });
});
