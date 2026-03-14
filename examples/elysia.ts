import { Elysia } from "elysia";
import { handleSyncRequest, MemorySyncBackend } from "minisync";

const backend = new MemorySyncBackend();

// You can use standard Elysia and pass down the `Request` to `handleSyncRequest`
const app = new Elysia().post("/api/sync/:action", async ({ request }) => {
  return handleSyncRequest(request, {
    backend,
    resolveIdentity: async (req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return null;

      const token = authHeader.replace(/^Bearer\s+/i, "");
      return { userId: token };
    },
  });
});

app.listen(3000);
console.log("Elysia server running on http://localhost:3000");
