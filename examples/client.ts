import { Database } from "bun:sqlite";
import { createSyncClient, HttpSyncBackend, installSync, syncTable } from "../src";

const db = new Database("app.db");
db.exec("create table if not exists notes (id text primary key, user_id text not null, title text not null, deleted_at text)");

installSync({
  db,
  tables: [syncTable("notes", { columns: ["id", "user_id", "title", "deleted_at"], deletedAtColumn: "deleted_at" })],
});

const client = createSyncClient({
  db,
  backend: new HttpSyncBackend({ baseUrl: "http://localhost:3000", headers: { authorization: "Bearer u1" } }),
  userId: "u1",
  tables: ["notes"],
  intervalMs: 5000,
});

client.start();
await client.syncNow();
