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
}
