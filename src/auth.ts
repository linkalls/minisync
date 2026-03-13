import type { Context } from "hono";

export interface AuthIdentity {
  userId: string;
  tenantId?: string;
  claims?: Record<string, unknown>;
}

export type AuthAdapter = (context: Context) => Promise<AuthIdentity | null> | AuthIdentity | null;

export function customAuth(adapter: AuthAdapter): AuthAdapter {
  return adapter;
}

export function bearerTokenAuth(options: {
  resolve: (token: string, context: Context) => Promise<AuthIdentity | null> | AuthIdentity | null;
  scheme?: string;
}): AuthAdapter {
  const scheme = options.scheme ?? "Bearer";
  return async (context) => {
    const header = context.req.header("authorization");
    if (!header) return null;
    const prefix = `${scheme} `;
    if (!header.startsWith(prefix)) return null;
    const token = header.slice(prefix.length).trim();
    if (!token) return null;
    return await options.resolve(token, context);
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    return payload;
  } catch {
    return null;
  }
}

export function jwtClaimsAuth(options?: {
  userIdClaims?: string[];
  tenantIdClaims?: string[];
  scheme?: string;
}): AuthAdapter {
  const userIdClaims = options?.userIdClaims ?? ["sub", "userId", "user_id"];
  const tenantIdClaims = options?.tenantIdClaims ?? ["org_id", "tenantId", "tenant_id"];
  return bearerTokenAuth({
    scheme: options?.scheme,
    resolve(token) {
      const payload = decodeJwtPayload(token);
      if (!payload) return null;
      const userId = userIdClaims.map((key) => payload[key]).find((value): value is string => typeof value === "string");
      if (!userId) return null;
      const tenantId = tenantIdClaims.map((key) => payload[key]).find((value): value is string => typeof value === "string");
      return { userId, tenantId, claims: payload };
    },
  });
}

export function clerkAuth(options?: {
  headerName?: string;
  userIdClaims?: string[];
  tenantIdClaims?: string[];
}): AuthAdapter {
  const headerName = options?.headerName ?? "authorization";
  const jwtAdapter = jwtClaimsAuth({
    userIdClaims: options?.userIdClaims ?? ["sub"],
    tenantIdClaims: options?.tenantIdClaims ?? ["org_id"],
  });
  return async (context) => {
    if (headerName !== "authorization") {
      const token = context.req.header(headerName);
      if (!token) return null;
      const fakeContext = {
        ...context,
        req: {
          ...context.req,
          header(name: string) {
            if (name.toLowerCase() === "authorization") return `Bearer ${token}`;
            return context.req.header(name);
          },
        },
      } as Context;
      return jwtAdapter(fakeContext);
    }
    return jwtAdapter(context);
  };
}

export function authJsAuth(options: {
  getSession: (context: Context) => Promise<{ user?: { id?: string | null }; orgId?: string | null } | null>;
}): AuthAdapter {
  return async (context) => {
    const session = await options.getSession(context);
    const userId = session?.user?.id;
    if (!userId) return null;
    return {
      userId,
      tenantId: session.orgId ?? undefined,
      claims: session as unknown as Record<string, unknown>,
    };
  };
}

export function chainAuth(...adapters: AuthAdapter[]): AuthAdapter {
  return async (context) => {
    for (const adapter of adapters) {
      const result = await adapter(context);
      if (result) return result;
    }
    return null;
  };
}
