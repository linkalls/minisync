import { createDrizzleSyncServer, authJsAuth } from "../src";
import { Database } from "bun:sqlite";

async function getSessionFromYourApp(_context: unknown) {
  return {
    user: { id: "u1" },
    orgId: null,
  };
}

const db = new Database("sync.db");
db.exec("pragma journal_mode = wal");

export default await createDrizzleSyncServer({
  db,
  auth: authJsAuth({
    getSession: async (c) => getSessionFromYourApp(c),
  }),
});
