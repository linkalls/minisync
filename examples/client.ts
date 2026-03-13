import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createSyncClient, HttpSyncBackend, installSync, syncTable } from "../src";

const db = new Database("app.db");
db.exec("create table if not exists notes (id text primary key, user_id text not null, title text not null, deleted_at text)");

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

const session = { user: { id: "u1" } };

const client = createSyncClient({
  db,
  backend: new HttpSyncBackend({ baseUrl: "http://localhost:3000", headers: { authorization: "Bearer token" } }),
  userId: session.user.id,
  tables: ["notes"],
  intervalMs: 5000,
});

client.start();
await client.syncNow();
