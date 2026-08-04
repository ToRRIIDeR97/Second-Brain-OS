export type ContextInspectorItem = {
  id: string;
  label: string;
  kind: string;
  authority: string;
  score: number;
  reasons: string[];
  sourceHash: string;
  tokenCount: number;
  required: boolean;
  included: boolean;
  stale: boolean;
};

export type ContextInspectorExclusion = {
  candidateId: string;
  reason: string;
};

export type ContextInspectorPacket = {
  packetId: string;
  tokenBudget: number;
  tokenCount: number;
  indexGeneration: number;
  currentGeneration: number;
  graphDepth: 0 | 1 | 2;
  rawSerialization: string;
  items: ContextInspectorItem[];
  exclusions: ContextInspectorExclusion[];
};

export type ContextSourceGroup = "required" | "optional";

export function contextUsagePercent(
  tokenCount: number,
  tokenBudget: number,
): number {
  if (tokenBudget <= 0) return 0;
  return Math.min(
    100,
    Math.round((Math.max(0, tokenCount) / tokenBudget) * 100),
  );
}
