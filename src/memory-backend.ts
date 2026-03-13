import { resolveLww } from "./conflict";
import { nextHlc } from "./hlc";
import type { PullRequest, PullResponse, PushRequest, PushResponse, SyncBackend, SyncChange } from "./types";

interface StoredChange extends SyncChange {
  checkpoint: string;
}

export class MemorySyncBackend implements SyncBackend {
  private changes: StoredChange[] = [];
  private rows = new Map<string, SyncChange>();
  private lastCheckpoint = "";

  async pullChanges(request: PullRequest): Promise<PullResponse> {
    const filtered = this.changes.filter((change) => {
      if (change.row.userId !== request.userId) return false;
      if (request.tables && !request.tables.includes(change.table)) return false;
      if (!request.checkpoint) return true;
      return change.checkpoint > request.checkpoint;
    });
    return {
      checkpoint: this.lastCheckpoint,
      changes: filtered,
    };
  }

  async pushChanges(request: PushRequest): Promise<PushResponse> {
    for (const change of request.changes) {
      if (change.row.userId !== request.userId) {
        throw new Error("ownership mismatch");
      }
      const key = `${change.table}:${change.row.id}:${change.row.userId}`;
      const current = this.rows.get(key);
      const next = !current
        ? change
        : {
            ...change,
            row: resolveLww(current.row, change.row),
          };
      this.rows.set(key, next);
      const checkpoint = nextHlc({ last: this.lastCheckpoint, nodeId: "server" });
      this.lastCheckpoint = checkpoint;
      this.changes.push({ ...next, checkpoint });
    }
    return {
      accepted: request.changes.length,
      checkpoint: this.lastCheckpoint,
      acknowledgedIds: request.changes.map((change) => `${change.table}:${change.row.id}`),
    };
  }
}
