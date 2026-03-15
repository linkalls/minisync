import { Database } from "bun:sqlite";
import { createDrizzleSyncServer } from "../src";
import { Hono } from "hono";

const db = new Database("server.db");

// createDrizzleSyncServer wraps the raw Database automatically,
// creates the _remote_changes table if needed, and returns a Hono app.
const syncApp = await createDrizzleSyncServer({ db });

const app = new Hono();
app.route("/sync", syncApp);

export default {
  port: 3000,
  fetch: app.fetch,
};

console.log("Sync server running at http://localhost:3000/sync");
