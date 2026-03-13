import { Hono } from "hono";
import type { SyncBackend } from "./types";

export interface CreateSyncServerOptions {
  backend: SyncBackend;
}

export function createSyncServer(options: CreateSyncServerOptions) {
  const app = new Hono();

  app.post("/push", async (c) => {
    const body = await c.req.json();
    const result = await options.backend.pushChanges(body);
    return c.json(result);
  });

  app.post("/pull", async (c) => {
    const body = await c.req.json();
    const result = await options.backend.pullChanges(body);
    return c.json(result);
  });

  return app;
}
