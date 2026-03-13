export interface HlcParts {
  wallTimeMs: number;
  counter: number;
  nodeId: string;
}

export function encodeHlc(parts: HlcParts): string {
  return `${parts.wallTimeMs.toString().padStart(13, "0")}-${parts.counter
    .toString()
    .padStart(6, "0")}-${parts.nodeId}`;
}

export function decodeHlc(value: string): HlcParts {
  const [wall, counter, ...node] = value.split("-");
  if (!wall || !counter || node.length === 0) {
    throw new Error(`Invalid HLC: ${value}`);
  }
  return {
    wallTimeMs: Number(wall),
    counter: Number(counter),
    nodeId: node.join("-"),
  };
}

export function compareHlc(a: string, b: string): number {
  return a.localeCompare(b);
}

export function nextHlc(params?: {
  nowMs?: number;
  last?: string;
  nodeId?: string;
}): string {
  const nowMs = params?.nowMs ?? Date.now();
  const nodeId = params?.nodeId ?? "local";
  if (!params?.last) {
    return encodeHlc({ wallTimeMs: nowMs, counter: 0, nodeId });
  }
  const last = decodeHlc(params.last);
  if (nowMs > last.wallTimeMs) {
    return encodeHlc({ wallTimeMs: nowMs, counter: 0, nodeId });
  }
  return encodeHlc({ wallTimeMs: last.wallTimeMs, counter: last.counter + 1, nodeId });
}
