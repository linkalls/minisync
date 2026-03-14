import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { authJsAuth, bearerTokenAuth, chainAuth, clerkAuth, jwtClaimsAuth } from "../src";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

async function runAdapter(
  adapter: (context: any) => unknown,
  headers: Record<string, string> = {},
) {
  const app = new Hono();
  let result: unknown = null;
  app.get("/", async (c) => {
    result = await adapter(c);
    return c.text("ok");
  });
  await app.request("http://local/", { headers });
  return result;
}

describe("auth adapters", () => {
  test("jwtClaimsAuth resolves userId from sub", async () => {
    const token = makeJwt({ sub: "u1", org_id: "t1" });
    const result = await runAdapter(jwtClaimsAuth(), { authorization: `Bearer ${token}` });
    expect(result).toEqual({ userId: "u1", tenantId: "t1", claims: { sub: "u1", org_id: "t1" } });
  });

  test("clerkAuth reads clerk-style jwt", async () => {
    const token = makeJwt({ sub: "user_clerk", org_id: "org_clerk" });
    const result = await runAdapter(clerkAuth(), { authorization: `Bearer ${token}` });
    expect(result).toEqual({ userId: "user_clerk", tenantId: "org_clerk", claims: { sub: "user_clerk", org_id: "org_clerk" } });
  });

  test("authJsAuth resolves from session getter", async () => {
    const adapter = authJsAuth({
      async getSession() {
        return { user: { id: "authjs-user" }, orgId: "org-authjs" };
      },
    });
    const result = await runAdapter(adapter);
    expect(result).toEqual({
      userId: "authjs-user",
      tenantId: "org-authjs",
      claims: { user: { id: "authjs-user" }, orgId: "org-authjs" },
    });
  });

  test("bearerTokenAuth can use custom resolver", async () => {
    const adapter = bearerTokenAuth({
      resolve(token) {
        return token === "secret" ? { userId: "u-secret" } : null;
      },
    });
    const result = await runAdapter(adapter, { authorization: "Bearer secret" });
    expect(result).toEqual({ userId: "u-secret" });
  });

  test("chainAuth tries adapters in order", async () => {
    const token = makeJwt({ sub: "u2" });
    const adapter = chainAuth(
      authJsAuth({ async getSession() { return null; } }),
      jwtClaimsAuth(),
    );
    const result = await runAdapter(adapter, { authorization: `Bearer ${token}` });
    expect(result).toEqual({ userId: "u2", tenantId: undefined, claims: { sub: "u2" } });
  });
});
