import { auth } from "@/auth";
import { bunSqliteAdapter, createSyncRouteHandlers, resolveAuthJsIdentity, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

// For Next.js Route Handlers we use the lower-level `SqliteSyncBackend` +
// `bunSqliteAdapter` because createSyncRouteHandlers expects a SyncBackend,
// not a Hono app.  For standalone Bun/Node servers use `createDrizzleSyncServer`
// instead — it handles adapter wrapping and `init()` automatically.
const rawDb = new Database("sync.db");
const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(rawDb) });

// Export the Next.js Route Handlers
// Place this file at: app/api/sync/[action]/route.ts
export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
