import { Hono } from "hono";
import { createSyncServer, MemorySyncBackend, bearerTokenAuth } from "minisync";

const app = new Hono();
const backend = new MemorySyncBackend();

// A self-contained Hono app for minisync requests
// Mount it to your main server, like:
// app.route("/api/sync", syncApp)
const syncApp = createSyncServer({
  backend,
  auth: bearerTokenAuth({
    // Simple custom resolver: treating the bearer token as the user ID
    resolve: async (token) => {
      if (!token) return null;
      return { userId: token };
    },
  }),
});

export default syncApp;
