import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema for the server-side `_remote_changes` table managed by
 * `SqliteSyncBackend`.
 *
 * Export this from your Drizzle schema file so that drizzle-kit includes the
 * table in your migrations:
 *
 * ```ts
 * // db/schema.ts
 * export * from "minisync/sqlite-core";   // re-export the minisync table
 * export * from "./your-own-tables";
 * ```
 *
 * You can also rename the underlying SQL table by passing a custom
 * `changesTable` to `SqliteSyncBackend` / `createDrizzleSyncServer` —
 * make sure the schema name matches in that case.
 */
export const remoteChangesTable = sqliteTable("_remote_changes", {
  checkpoint: text("checkpoint").primaryKey(),
  tableName: text("table_name").notNull(),
  op: text("op").$type<"upsert" | "delete">().notNull(),
  rowId: text("row_id").notNull(),
  userId: text("user_id").notNull(),
  hlc: text("hlc").notNull(),
  /** Stored as `0` / `1` to stay compatible with all SQLite drivers. */
  deleted: integer("deleted").notNull().default(0),
  payload: text("payload").notNull(),
});

/** TypeScript type for a row returned from `_remote_changes`. */
export type RemoteChangeRow = typeof remoteChangesTable.$inferSelect;

/** TypeScript type for a row inserted into `_remote_changes`. */
export type InsertRemoteChangeRow = typeof remoteChangesTable.$inferInsert;
