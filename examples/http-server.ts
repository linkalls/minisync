import { Database } from "bun:sqlite";
import { createSyncServer, SqliteSyncBackend, type SyncBackend } from "../src";

const db = new Database("sync.db");
const backend: SyncBackend = new SqliteSyncBackend({ db });
(db as Database).exec("pragma journal_mode = wal");
(backend as SqliteSyncBackend).init();

export default createSyncServer({
  backend,
  auth: async (c) => {
    const header = c.req.header("authorization");
    const userId = header?.replace(/^Bearer\s+/i, "")?.trim();
    if (!userId) return null;
    return { userId };
  },
});
