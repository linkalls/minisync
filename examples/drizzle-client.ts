import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createDrizzleSyncClient, HttpSyncBackend } from "../src";

const db = new Database("app.db");
db.exec("create table if not exists notes (id text primary key, user_id text not null, title text not null, deleted_at text)");

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),
});

const session = { user: { id: "u1" } };
const token = "your-auth-token";

// Pass the raw Bun Database directly — createDrizzleSyncClient wraps it automatically.
const sync = await createDrizzleSyncClient({
  db,
  backend: new HttpSyncBackend({
    baseUrl: "http://localhost:3000/api/sync",
    headers: { authorization: `Bearer ${token}` },
  }),
  userId: session.user.id,
  schema: [notes],
  intervalMs: 5000,
  autoStart: true,
});

await sync.syncNow();
