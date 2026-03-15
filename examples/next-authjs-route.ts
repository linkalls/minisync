import { auth } from "@/auth";
import { bunSqliteAdapter, createSyncRouteHandlers, resolveAuthJsIdentity, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

// Instantiate your database and backend.
// bunSqliteAdapter wraps Bun's Database into the AsyncDatabase interface.
// SqliteSyncBackend.init() is called automatically on first use — no manual call needed.
const rawDb = new Database("sync.db");
const backend = new SqliteSyncBackend({ db: bunSqliteAdapter(rawDb) });

// Export the Next.js Route Handlers
// Place this file at: app/api/sync/[action]/route.ts
export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
