import { Database } from "bun:sqlite";
import { SqliteSyncBackend, createSyncServer } from "../src";
import { Hono } from "hono";

// Create or open the real SQLite database for the server backend
const db = new Database("server.db");

// Initialize the SqliteSyncBackend
const backend = new SqliteSyncBackend({ db });
backend.init(); // This creates the _remote_changes table

// Create the sync server routes
// Note: We don't provide an auth adapter here for simplicity in the example.
// Clients will just pass { userId: "some-id" } in the JSON body.
const syncApp = createSyncServer({ backend });

// Mount the sync server under a specific route prefix (e.g. /sync)
const app = new Hono();
app.route("/sync", syncApp);

// Export for Bun to serve
export default {
  port: 3000,
  fetch: app.fetch,
};

console.log("Sync server running at http://localhost:3000/sync");
