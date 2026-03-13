import { describe, expect, test } from "bun:test";
import { SupabaseSyncBackend, supabaseSqlSetup } from "../src";

describe("supabase backend", () => {
  test("calls rpc for pull and push", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
    const backend = new SupabaseSyncBackend({
      client: {
        async rpc(fn, args) {
          calls.push({ fn, args });
          if (fn === "minisync_pull") {
            return { data: { checkpoint: "c1", changes: [] }, error: null };
          }
          return { data: { accepted: 1, checkpoint: "c2", acknowledgedIds: ["notes:n1"] }, error: null };
        },
      },
    });

    const pull = await backend.pullChanges({ userId: "u1", tables: ["notes"] });
    const push = await backend.pushChanges({
      userId: "u1",
      changes: [
        {
          table: "notes",
          op: "upsert",
          row: { id: "n1", userId: "u1", data: { title: "x" }, hlc: "1", deleted: false },
        },
      ],
    });

    expect(pull.checkpoint).toBe("c1");
    expect(push.acknowledgedIds).toEqual(["notes:n1"]);
    expect(calls.map((call) => call.fn)).toEqual(["minisync_pull", "minisync_push"]);
  });

  test("emits sql setup for supabase functions", () => {
    const sql = supabaseSqlSetup();
    expect(sql).toContain("create or replace function public.minisync_pull");
    expect(sql).toContain("create or replace function public.minisync_push");
    expect(sql).toContain("create table if not exists public._remote_changes");
  });
});
