import { Database } from "bun:sqlite";
import { auth } from "@/auth";
import { createSyncRouteHandlers, resolveAuthJsIdentity, SqliteSyncBackend } from "../src";

const db = new Database("sync.db");
const backend = new SqliteSyncBackend({ db });
backend.init();

export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
