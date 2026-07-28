import { describe, expect, it } from "vitest";
import {
  autosaveReducer,
  canRestoreRecoveryEntry,
  createAutosaveState,
  createRecoveryEntry,
  mergeMarkdown,
} from "./recovery";

describe("Markdown autosave and recovery", () => {
  it("journals before save and only clears the current saved revision", () => {
    let state = createAutosaveState("# Note\n", "base-1", "notes/note.md");
    state = autosaveReducer(state, {
      type: "changed",
      content: "# Note\n\nDraft\n",
    });
    expect(autosaveReducer(state, { type: "saveRequested" }).status).toBe(
      "dirty",
    );
    state = autosaveReducer(state, {
      type: "journaled",
      revision: state.editRevision,
    });
    state = autosaveReducer(state, { type: "saveRequested" });
    const savingRevision = state.savingRevision;
    expect(savingRevision).toBeDefined();
    if (savingRevision === undefined) return;
    state = autosaveReducer(state, {
      type: "changed",
      content: "# Note\n\nNewer draft\n",
    });
    state = autosaveReducer(state, {
      type: "saveSucceeded",
      revision: savingRevision,
      content: "# Note\n\nDraft\n",
      baseHash: "base-2",
    });
    expect(state.status).toBe("dirty");
    expect(state.content).toContain("Newer draft");
    expect(state.journalRevision).toBe(1);
  });

  it("binds compatible recovery entries to workspace, path, hash, and codec", () => {
    const state = autosaveReducer(
      createAutosaveState("base", "hash", "notes/a.md"),
      { type: "changed", content: "draft" },
    );
    const entry = createRecoveryEntry(
      state,
      "workspace-1",
      "2026-07-28T00:00:00.000Z",
    );
    expect(entry).toMatchObject({
      workspaceId: "workspace-1",
      relativePath: "notes/a.md",
      baseHash: "hash",
      content: "draft",
    });
    expect(canRestoreRecoveryEntry(entry, "workspace-1")).toBe(true);
    expect(canRestoreRecoveryEntry(entry, "workspace-2")).toBe(false);
    expect(
      canRestoreRecoveryEntry({ ...entry, codecVersion: 99 }, "workspace-1"),
    ).toBe(false);
  });

  it("merges disjoint source edits and keeps overlap explicit", () => {
    const base = "# Note\n\n:::future\nopaque\n:::\n\nTail";
    expect(
      mergeMarkdown(
        base,
        "# Changed\n\n:::future\nopaque\n:::\n\nTail",
        "# Note\n\n:::future\nopaque\n:::\n\nEdited tail",
      ),
    ).toEqual({
      status: "clean",
      content: "# Changed\n\n:::future\nopaque\n:::\n\nEdited tail",
    });
    expect(mergeMarkdown("one\ntwo", "disk\ntwo", "editor\ntwo").status).toBe(
      "conflict",
    );
  });
});
