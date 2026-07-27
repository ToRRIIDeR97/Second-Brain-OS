import { describe, expect, it } from "vitest";
import { mapMonacoLineChanges, nextDiffHunk, selectDiffHunk } from "./diff";

describe("diff hunk navigation", () => {
  it("maps Monaco changes to stable source locations", () => {
    const hunks = mapMonacoLineChanges([
      {
        originalStartLineNumber: 3,
        originalEndLineNumber: 4,
        modifiedStartLineNumber: 3,
        modifiedEndLineNumber: 5,
      },
    ]);
    expect(hunks).toEqual([
      {
        id: "hunk-1",
        originalStartLine: 3,
        originalLineCount: 2,
        modifiedStartLine: 3,
        modifiedLineCount: 3,
      },
    ]);
    const [first] = hunks;
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(selectDiffHunk(first, "modified").line).toBe(3);
  });

  it("wraps keyboard navigation at both ends", () => {
    const hunks = mapMonacoLineChanges([
      {
        originalStartLineNumber: 1,
        originalEndLineNumber: 1,
        modifiedStartLineNumber: 1,
        modifiedEndLineNumber: 2,
      },
      {
        originalStartLineNumber: 9,
        originalEndLineNumber: 9,
        modifiedStartLineNumber: 10,
        modifiedEndLineNumber: 10,
      },
    ]);
    expect(nextDiffHunk(hunks, "hunk-2", 1)?.id).toBe("hunk-1");
    expect(nextDiffHunk(hunks, "hunk-1", -1)?.id).toBe("hunk-2");
  });
});
