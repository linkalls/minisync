import { Hono } from "hono";
import type { Context } from "hono";
import { AuthError } from "./errors";
import type { PullRequest, PushRequest, SyncBackend } from "./types";

export interface AuthResult {
  userId: string;
}

export interface CreateSyncServerOptions {
  backend: SyncBackend;
  auth?: (context: Context) => Promise<AuthResult | null> | AuthResult | null;
}

export function createSyncServer(options: CreateSyncServerOptions) {
  const app = new Hono();

  app.post("/push", async (c) => {
    try {
      const body = (await c.req.json()) as PushRequest;
      const auth = options.auth ? await options.auth(c) : { userId: body.userId };
      if (!auth) throw new AuthError();
      const result = await options.backend.pushChanges({ ...body, userId: auth.userId });
      return c.json(result);
    } catch (error) {
      if (error instanceof AuthError) return c.json({ error: error.message, code: error.code }, error.status as 401);
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "SYNC_SERVER_ERROR" }, 500);
    }
  });

  app.post("/pull", async (c) => {
    try {
      const body = (await c.req.json()) as PullRequest;
      const auth = options.auth ? await options.auth(c) : { userId: body.userId };
      if (!auth) throw new AuthError();
      const result = await options.backend.pullChanges({ ...body, userId: auth.userId });
      return c.json(result);
    } catch (error) {
      if (error instanceof AuthError) return c.json({ error: error.message, code: error.code }, error.status as 401);
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message, code: "SYNC_SERVER_ERROR" }, 500);
    }
  });

  return app;
}
