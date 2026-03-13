import { compareHlc } from "./hlc";
import type { SyncRow } from "./types";

export function resolveLww(localRow: SyncRow, remoteRow: SyncRow): SyncRow {
  const order = compareHlc(localRow.hlc, remoteRow.hlc);
  if (order === 0) {
    return localRow.id >= remoteRow.id ? localRow : remoteRow;
  }
  return order > 0 ? localRow : remoteRow;
}
