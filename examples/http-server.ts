import { Database } from "bun:sqlite";
import { authJsAuth, createSyncServer, SqliteSyncBackend, type SyncBackend } from "../src";

async function getSessionFromYourApp(_context: unknown) {
  return {
    user: { id: "u1" },
    orgId: null,
  };
}

const db = new Database("sync.db");
const backend: SyncBackend = new SqliteSyncBackend({ db });
(db as Database).exec("pragma journal_mode = wal");
(backend as SqliteSyncBackend).init();

export default createSyncServer({
  backend,
  auth: authJsAuth({
    getSession: async (c) => getSessionFromYourApp(c),
  }),
});
