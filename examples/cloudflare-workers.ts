import { Hono } from "hono";
import { handleSyncRequest, MemorySyncBackend } from "minisync";

// For Cloudflare Workers (or environments without an embedded `Database`)
// you can use the handleSyncRequest primitive directly or MemorySyncBackend for testing
const app = new Hono();
const backend = new MemorySyncBackend();

app.post("/api/sync/:action", async (c) => {
  return handleSyncRequest(c.req.raw, {
    backend,
    resolveIdentity: async (req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return null;
      // Resolve token logic
      const token = authHeader.replace(/^Bearer\s+/i, "");
      return { userId: token };
    },
  });
});

export default app;
