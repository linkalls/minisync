import { auth } from "@/auth";
import { createSyncRouteHandlers, resolveAuthJsIdentity, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

// Instantiate your database and backend
const db = new Database("sync.db");
const backend = new SqliteSyncBackend({ db });
backend.init();

// Export the Next.js Route Handlers
// These will seamlessly plug into your `app/api/sync/[action]/route.ts` Next.js 13+ App Router API file.
export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
