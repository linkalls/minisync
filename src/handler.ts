import type { AuthIdentity } from "./auth";
import type { PullRequest, PushRequest, SyncBackend } from "./types";

export interface HandleSyncRequestOptions {
  backend: SyncBackend;
  resolveIdentity: (request: Request) => Promise<AuthIdentity | null> | AuthIdentity | null;
}

export async function handleSyncRequest(request: Request, options: HandleSyncRequestOptions): Promise<Response> {
  try {
    const identity = await options.resolveIdentity(request);
    if (!identity) {
      return Response.json({ error: "Unauthorized", code: "AUTH_ERROR" }, { status: 401 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const body = (await request.json()) as PullRequest | PushRequest;

    if (pathname.endsWith("/push")) {
      const result = await options.backend.pushChanges({
        ...(body as PushRequest),
        userId: identity.userId,
      });
      return Response.json(result);
    }

    if (pathname.endsWith("/pull")) {
      const result = await options.backend.pullChanges({
        ...(body as PullRequest),
        userId: identity.userId,
      });
      return Response.json(result);
    }

    return Response.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message, code: "SYNC_HANDLER_ERROR" }, { status: 500 });
  }
}

export function createSyncRouteHandlers(options: HandleSyncRequestOptions) {
  return {
    POST(request: Request) {
      return handleSyncRequest(request, options);
    },
  };
}
