import { describe, expect, it, vi } from "vitest";

import { eolForContent, languageForPath, normalizeEol } from "./language";
import { SourceModelRegistry } from "./modelRegistry";
import { editorReducer, initialEditorState } from "./reducer";
import type { EditorTabState } from "./types";

const tab = (overrides: Partial<EditorTabState> = {}): EditorTabState => ({
  resourceId: "resource-1",
  workspaceId: "workspace-1",
  relativePath: "src/main.ts",
  modelUri: "agent-os://workspace/workspace-1/resource/resource-1",
  language: "typescript",
  encoding: "utf8",
  eol: "lf",
  status: "opening",
  content: "",
  baseHash: "",
  baseRevisionId: "",
  baseContent: "",
  externalChange: "none",
  openRequest: 1,
  ...overrides,
});

describe("source editor state", () => {
  it("ignores stale asynchronous reads", () => {
    const opening = editorReducer(initialEditorState, {
      type: "openRequested",
      tab: tab({ openRequest: 2 }),
    });
    const stale = editorReducer(opening, {
      type: "openSucceeded",
      resourceId: "resource-1",
      request: 1,
      file: {
        content: "stale",
        contentHash: "stale",
        revisionId: "stale",
        encoding: "utf8",
        eol: "lf",
        sizeBytes: 5,
      },
    });
    expect(stale.tabs["resource-1"]?.status).toBe("opening");
  });

  it("tracks dirty, saved, and renamed state", () => {
    let state = editorReducer(initialEditorState, {
      type: "openRequested",
      tab: tab(),
    });
    state = editorReducer(state, {
      type: "openSucceeded",
      resourceId: "resource-1",
      request: 1,
      file: {
        content: "one",
        contentHash: "hash-1",
        revisionId: "rev-1",
        encoding: "utf8",
        eol: "lf",
        sizeBytes: 3,
      },
    });
    state = editorReducer(state, {
      type: "contentChanged",
      resourceId: "resource-1",
      content: "two",
    });
    expect(state.tabs["resource-1"]?.status).toBe("dirty");
    state = editorReducer(state, {
      type: "saveRequested",
      resourceId: "resource-1",
    });
    state = editorReducer(state, {
      type: "saveSucceeded",
      resourceId: "resource-1",
      content: "two",
      file: {
        operationId: "op",
        revisionId: "rev-2",
        contentHash: "hash-2",
        sizeBytes: 3,
        mergeNotice: false,
      },
    });
    state = editorReducer(state, {
      type: "renamed",
      resourceId: "resource-1",
      relativePath: "src/renamed.ts",
    });
    expect(state.tabs["resource-1"]).toMatchObject({
      status: "clean",
      relativePath: "src/renamed.ts",
      externalChange: "renamed",
    });
  });
});

describe("source model registry", () => {
  it("shares one model and disposes after the final pane closes", () => {
    const dispose = vi.fn();
    const registry = new SourceModelRegistry<{ dispose: () => void }>();
    const first = registry.acquire("resource-1", () => ({ dispose }));
    const second = registry.acquire("resource-1", () => ({ dispose: vi.fn() }));
    expect(second).toBe(first);
    expect(registry.size).toBe(1);
    registry.release("resource-1");
    expect(dispose).not.toHaveBeenCalled();
    registry.release("resource-1");
    expect(dispose).toHaveBeenCalledOnce();
    expect(registry.size).toBe(0);
  });
});

describe("source language and line endings", () => {
  it("detects common languages and preserves EOL policy", () => {
    expect(languageForPath("src/main.ts")).toBe("typescript");
    expect(languageForPath("README.md")).toBe("markdown");
    expect(languageForPath("binary.dat")).toBe("plaintext");
    expect(eolForContent("a\r\nb\r\n")).toBe("crlf");
    expect(eolForContent("a\r\nb\n")).toBe("mixed");
    expect(normalizeEol("a\r\nb\n", "crlf")).toBe("a\r\nb\r\n");
  });
});
