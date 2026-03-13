import { describe, expect, test } from "bun:test";
import { createSyncRouteHandlers, MemorySyncBackend, nextHlc, resolveAuthJsIdentity } from "../src";

describe("embedded handler", () => {
  test("handles push and pull with resolveIdentity", async () => {
    const backend = new MemorySyncBackend();
    const handlers = createSyncRouteHandlers({
      backend,
      resolveIdentity: async () => ({ userId: "u1" }),
    });

    const pushReq = new Request("http://local/api/sync/push", {
      method: "POST",
      body: JSON.stringify({
        userId: "wrong",
        changes: [
          {
            table: "notes",
            op: "upsert",
            row: { id: "n1", userId: "u1", data: { title: "hello" }, hlc: nextHlc({ nowMs: 1, nodeId: "c" }), deleted: false },
          },
        ],
      }),
      headers: { "content-type": "application/json" },
    });

    const pushRes = await handlers.POST(pushReq);
    expect(pushRes.status).toBe(200);

    const pullReq = new Request("http://local/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ userId: "wrong", tables: ["notes"] }),
      headers: { "content-type": "application/json" },
    });
    const pullRes = await handlers.POST(pullReq);
    const pullJson = (await pullRes.json()) as { changes: unknown[] };
    expect(pullRes.status).toBe(200);
    expect(pullJson.changes).toHaveLength(1);
  });

  test("returns 401 when identity cannot be resolved", async () => {
    const handlers = createSyncRouteHandlers({
      backend: new MemorySyncBackend(),
      resolveIdentity: async () => null,
    });

    const req = new Request("http://local/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", tables: ["notes"] }),
      headers: { "content-type": "application/json" },
    });

    const res = await handlers.POST(req);
    expect(res.status).toBe(401);
  });

  test("resolveAuthJsIdentity reads existing auth() session", async () => {
    const resolveIdentity = resolveAuthJsIdentity({
      auth: async () => ({ user: { id: "authjs-user" }, orgId: "org1" }),
    });

    const identity = await resolveIdentity(new Request("http://local/api/sync/pull", { method: "POST" }));
    expect(identity).toEqual({
      userId: "authjs-user",
      tenantId: "org1",
      claims: { user: { id: "authjs-user" }, orgId: "org1" },
    });
  });
});
