import type { AuthIdentity } from "./auth";

export interface AuthJsSession {
  user?: {
    id?: string | null;
  } | null;
  orgId?: string | null;
}

export interface AuthJsRouteOptions {
  auth: () => Promise<AuthJsSession | null>;
}

export function resolveAuthJsIdentity(options: AuthJsRouteOptions) {
  return async (_request: Request): Promise<AuthIdentity | null> => {
    const session = await options.auth();
    const userId = session?.user?.id;
    if (!userId) return null;
    return {
      userId,
      tenantId: session?.orgId ?? undefined,
      claims: session as unknown as Record<string, unknown>,
    };
  };
}
