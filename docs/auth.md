# Authentication

minisync is auth-agnostic. On the server side, you provide a function that extracts a `userId` from each incoming request. minisync ships several ready-to-use auth adapters.

---

## Auth in route handlers

`createSyncRouteHandlers` (and `handleSyncRequest`) takes a `resolveIdentity` function:

```ts
interface HandleSyncRequestOptions {
  backend: SyncBackend;
  resolveIdentity: (request: Request) => Promise<AuthIdentity | null> | AuthIdentity | null;
}
```

Return `null` to reject the request with a `401 Unauthorized` response.

```ts
export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const user = await verifyToken(token);
    return user ? { userId: user.id } : null;
  },
});
```

---

## Auth in the Hono server

`createSyncServer` uses an `AuthAdapter` typed for Hono's `Context`:

```ts
export type AuthAdapter = (context: Context) => Promise<AuthIdentity | null> | AuthIdentity | null;
```

---

## Built-in adapters

### `resolveAuthJsIdentity` — Auth.js / NextAuth

Ideal for Next.js apps that already use Auth.js:

```ts
import { auth } from "@/auth";
import { resolveAuthJsIdentity, createSyncRouteHandlers } from "minisync";

export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
```

`resolveAuthJsIdentity` calls `auth()` and extracts `session.user.id`. It also maps `session.orgId` to `tenantId`.

---

### `jwtClaimsAuth` — JWT Bearer tokens

Decodes a JWT from the `Authorization: Bearer <token>` header and extracts the user id from standard claims:

```ts
import { jwtClaimsAuth, createSyncServer } from "minisync";

const app = createSyncServer({
  backend,
  auth: jwtClaimsAuth({
    userIdClaims: ["sub"],          // default: ["sub", "userId", "user_id"]
    tenantIdClaims: ["org_id"],     // default: ["org_id", "tenantId", "tenant_id"]
  }),
});
```

> **Note:** `jwtClaimsAuth` only decodes the JWT payload — it does **not** verify the signature. Verify tokens in your infrastructure (e.g., an API gateway or middleware) before requests reach this handler.

---

### `clerkAuth` — Clerk

Reads a Clerk session token from the `Authorization` header (or a custom header):

```ts
import { clerkAuth, createSyncServer } from "minisync";

const app = createSyncServer({
  backend,
  auth: clerkAuth(),
  // auth: clerkAuth({ headerName: "x-clerk-token" }),
});
```

---

### `bearerTokenAuth` — custom token lookup

Extract a `userId` from any bearer token with a custom resolver:

```ts
import { bearerTokenAuth, createSyncServer } from "minisync";

const app = createSyncServer({
  backend,
  auth: bearerTokenAuth({
    resolve: async (token, _context) => {
      const user = await db.users.findByApiKey(token);
      return user ? { userId: user.id } : null;
    },
  }),
});
```

---

### `authJsAuth` — Auth.js (Hono)

When using `createSyncServer` (Hono), you can adapt Auth.js via a session getter:

```ts
import { authJsAuth, createSyncServer } from "minisync";

const app = createSyncServer({
  backend,
  auth: authJsAuth({
    getSession: async (context) => {
      // call your auth() equivalent with the Hono context
      return getMySession(context.req.raw);
    },
  }),
});
```

---

### `chainAuth` — fallback chain

Try multiple auth strategies in order, returning the first that succeeds:

```ts
import { chainAuth, jwtClaimsAuth, bearerTokenAuth } from "minisync";

const auth = chainAuth(
  jwtClaimsAuth(),
  bearerTokenAuth({ resolve: async (token) => lookupApiKey(token) }),
);
```

---

## `AuthIdentity`

All adapters return (or `null`):

```ts
interface AuthIdentity {
  userId: string;       // required — used to scope all data access
  tenantId?: string;    // optional — for multi-tenant apps
  claims?: Record<string, unknown>;  // raw claims / session data
}
```
