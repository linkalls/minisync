export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ChangeOp = "upsert" | "delete";

export interface SyncRow {
  id: string;
  userId: string;
  data: Record<string, JsonValue>;
  hlc: string;
  deleted: boolean;
}

export interface SyncChange {
  table: string;
  op: ChangeOp;
  row: SyncRow;
}

export interface PullRequest {
  userId: string;
  checkpoint?: string;
  tables?: string[];
}

export interface PullResponse {
  checkpoint: string;
  changes: SyncChange[];
}

export interface PushRequest {
  userId: string;
  changes: SyncChange[];
}

export interface PushResponse {
  accepted: number;
  checkpoint: string;
  acknowledgedIds?: string[];
  rejected?: Array<{ id: string; reason: string }>;
}

export interface SyncBackend {
  pullChanges(request: PullRequest): Promise<PullResponse>;
  pushChanges(request: PushRequest): Promise<PushResponse>;
}

export interface SyncClientOptions {
  db: Database;
  backend: SyncBackend;
  userId: string;
  tables: string[];
  autoStart?: boolean;
  intervalMs?: number;
  onSyncStart?: (event: { queued: number; checkpoint?: string }) => void;
  onSyncSuccess?: (event: { pushed: number; pulled: number; checkpoint: string }) => void;
  onConflict?: (event: { change: SyncChange }) => void;
  onError?: (event: { error: unknown }) => void;
}
