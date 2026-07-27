export interface MonacoLineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

export interface DiffHunk {
  id: string;
  originalStartLine: number;
  originalLineCount: number;
  modifiedStartLine: number;
  modifiedLineCount: number;
}

export interface DiffHunkSelection {
  hunk: DiffHunk;
  side: "original" | "modified";
  line: number;
}

export function mapMonacoLineChanges(
  changes: readonly MonacoLineChange[],
): DiffHunk[] {
  return changes.map((change, index) => ({
    id: `hunk-${String(index + 1)}`,
    originalStartLine: Math.max(1, change.originalStartLineNumber),
    originalLineCount: Math.max(
      0,
      change.originalEndLineNumber - change.originalStartLineNumber + 1,
    ),
    modifiedStartLine: Math.max(1, change.modifiedStartLineNumber),
    modifiedLineCount: Math.max(
      0,
      change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1,
    ),
  }));
}

export function selectDiffHunk(
  hunk: DiffHunk,
  side: DiffHunkSelection["side"],
): DiffHunkSelection {
  return {
    hunk,
    side,
    line: side === "original" ? hunk.originalStartLine : hunk.modifiedStartLine,
  };
}

export function nextDiffHunk(
  hunks: readonly DiffHunk[],
  currentId: string | undefined,
  direction: 1 | -1,
): DiffHunk | undefined {
  if (hunks.length === 0) return undefined;
  const currentIndex =
    currentId === undefined
      ? -1
      : hunks.findIndex((hunk) => hunk.id === currentId);
  const nextIndex =
    currentIndex < 0
      ? direction === 1
        ? 0
        : hunks.length - 1
      : (currentIndex + direction + hunks.length) % hunks.length;
  return hunks[nextIndex];
}
