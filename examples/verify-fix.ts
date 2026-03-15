import { Database } from "bun:sqlite";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createDrizzleSyncClient, SqliteSyncBackend, bunSqliteAdapter } from "../src";

// Setup Drizzle Schema
const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  revisions: integer("revisions").notNull(),
});

// Setup database instance
const db = new Database("client.db");

const USER_ID = "user-123";

async function runTests() {
  const serverDb = new Database("server.db");
  const serverBackend = new SqliteSyncBackend({ db: bunSqliteAdapter(serverDb) });
  await serverBackend.init();

  // Create client
  const syncClient = await createDrizzleSyncClient({
    db: bunSqliteAdapter(db),
    userId: USER_ID,
    schema: [cards],
    autoStart: false,
    backend: serverBackend
  });

  await syncClient.init();
  db.exec("DELETE FROM cards"); // reset
  db.exec("DELETE FROM _sync_queue"); // reset
  db.exec("DELETE FROM _sync_state"); // reset

  console.log("Running offline compaction and echo-back tests...");

  console.log("=== Testing Compaction ===");
  // Simulate offline inserts and updates
  db.exec("INSERT INTO cards (id, user_id, title, revisions) VALUES ('c1', 'user-123', 'card 1', 1)");
  db.exec("UPDATE cards SET revisions = 2 WHERE id = 'c1'");
  db.exec("UPDATE cards SET revisions = 3 WHERE id = 'c1'");

  // We should have 3 items in the sync queue right now.
  const queueBeforePush = db.query("SELECT * FROM _sync_queue").all();
  if (queueBeforePush.length !== 3) {
    throw new Error(`Expected 3 items in _sync_queue before push, got ${queueBeforePush.length}`);
  }

  // push() should compact the queue and only push the latest row
  const pushed = await syncClient.push();
  if (pushed !== 1) {
    throw new Error(`Expected exactly 1 row to be pushed due to compaction, but got ${pushed}`);
  }

  // Ensure queue is empty after push
  const queueAfterPush = db.query("SELECT * FROM _sync_queue").all();
  if (queueAfterPush.length !== 0) {
    throw new Error(`Expected 0 items in _sync_queue after push, got ${queueAfterPush.length}`);
  }

  console.log("Compaction test passed.");

  console.log("=== Testing Echo-back ===");
  // Simulate another client inserting a record directly into the server db
  const remoteHlc = new Date().toISOString(); // dummy HLC
  serverDb.exec("INSERT INTO _remote_changes (checkpoint, table_name, op, row_id, user_id, hlc, deleted, payload) VALUES (?, 'cards', 'upsert', 'c2', 'user-123', ?, 0, '{\"id\":\"c2\",\"user_id\":\"user-123\",\"title\":\"card 2\",\"revisions\":1}')", remoteHlc, remoteHlc);

  // Pull remote changes
  const pulled = await syncClient.pull();

  // The local cards table should now have the pulled card
  const localCards = db.query("SELECT * FROM cards WHERE id = 'c2'").all();
  if (localCards.length !== 1) {
    throw new Error(`Failed to insert the pulled card into the local database.`);
  }

  // Verify that the trigger did NOT echo this change back into _sync_queue
  const queueAfterPull = db.query("SELECT * FROM _sync_queue").all();
  if (queueAfterPull.length !== 0) {
    throw new Error(`Echo-back bug! Expected 0 items in _sync_queue after pulling remote changes, but got ${queueAfterPull.length}`);
  }

  console.log("Echo-back test passed.");
  console.log("All tests passed!");
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
