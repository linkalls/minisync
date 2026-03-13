import type { SyncChange } from "./types";

export interface SyncEventMap {
  syncStart: { queued: number; checkpoint?: string };
  syncSuccess: { pushed: number; pulled: number; checkpoint: string };
  conflict: { change: SyncChange };
  error: { error: unknown };
}

export type SyncEventName = keyof SyncEventMap;
export type SyncEventHandler<K extends SyncEventName> = (payload: SyncEventMap[K]) => void;
