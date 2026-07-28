import { MARKDOWN_CODEC_VERSION } from "./codec";

export const RECOVERY_JOURNAL_VERSION = 1 as const;

export interface RecoveryEntry {
  journalVersion: number;
  codecVersion: number;
  workspaceId: string;
  relativePath: string;
  baseHash: string;
  content: string;
  editRevision: number;
  updatedAt: string;
}

export type AutosaveStatus =
  | "clean"
  | "dirty"
  | "journaled"
  | "saving"
  | "conflict"
  | "error";

export interface AutosaveState {
  status: AutosaveStatus;
  content: string;
  baseContent: string;
  baseHash: string;
  relativePath: string;
  editRevision: number;
  journalRevision: number | undefined;
  savingRevision: number | undefined;
  error: string | undefined;
}

export type AutosaveAction =
  | { type: "changed"; content: string }
  | { type: "journaled"; revision: number }
  | { type: "saveRequested" }
  | {
      type: "saveSucceeded";
      revision: number;
      content: string;
      baseHash: string;
    }
  | { type: "saveFailed"; error: string; conflict?: boolean }
  | { type: "renamed"; relativePath: string }
  | { type: "externalDeleted" | "permissionLost" }
  | { type: "restored"; entry: RecoveryEntry }
  | { type: "discarded" };

export function createAutosaveState(
  content: string,
  baseHash: string,
  relativePath: string,
): AutosaveState {
  return {
    status: "clean",
    content,
    baseContent: content,
    baseHash,
    relativePath,
    editRevision: 0,
    journalRevision: undefined,
    savingRevision: undefined,
    error: undefined,
  };
}

export function autosaveReducer(
  state: AutosaveState,
  action: AutosaveAction,
): AutosaveState {
  switch (action.type) {
    case "changed":
      return {
        ...state,
        content: action.content,
        editRevision: state.editRevision + 1,
        status: action.content === state.baseContent ? "clean" : "dirty",
      };
    case "journaled":
      return action.revision === state.editRevision
        ? { ...state, journalRevision: action.revision, status: "journaled" }
        : state;
    case "saveRequested":
      return state.status === "journaled"
        ? {
            ...state,
            savingRevision: state.editRevision,
            status: "saving",
          }
        : state;
    case "saveSucceeded":
      if (action.revision !== state.savingRevision) return state;
      return action.revision === state.editRevision
        ? {
            ...state,
            content: action.content,
            baseContent: action.content,
            baseHash: action.baseHash,
            status: "clean",
            journalRevision: undefined,
            savingRevision: undefined,
            error: undefined,
          }
        : {
            ...state,
            baseContent: action.content,
            baseHash: action.baseHash,
            status: "dirty",
            savingRevision: undefined,
          };
    case "saveFailed":
      return {
        ...state,
        status: action.conflict ? "conflict" : "error",
        savingRevision: undefined,
        error: action.error,
      };
    case "renamed":
      return { ...state, relativePath: action.relativePath };
    case "externalDeleted":
      return { ...state, status: "conflict", error: "File was deleted." };
    case "permissionLost":
      return { ...state, status: "error", error: "Write permission was lost." };
    case "restored":
      return {
        ...state,
        content: action.entry.content,
        relativePath: action.entry.relativePath,
        editRevision: action.entry.editRevision,
        journalRevision: action.entry.editRevision,
        status: "journaled",
      };
    case "discarded":
      return {
        ...state,
        content: state.baseContent,
        status: "clean",
        journalRevision: undefined,
        savingRevision: undefined,
        error: undefined,
      };
  }
}

export function createRecoveryEntry(
  state: AutosaveState,
  workspaceId: string,
  updatedAt = new Date().toISOString(),
): RecoveryEntry {
  return {
    journalVersion: RECOVERY_JOURNAL_VERSION,
    codecVersion: MARKDOWN_CODEC_VERSION,
    workspaceId,
    relativePath: state.relativePath,
    baseHash: state.baseHash,
    content: state.content,
    editRevision: state.editRevision,
    updatedAt,
  };
}

export function canRestoreRecoveryEntry(
  entry: RecoveryEntry,
  workspaceId: string,
): boolean {
  return (
    entry.journalVersion === RECOVERY_JOURNAL_VERSION &&
    entry.codecVersion === MARKDOWN_CODEC_VERSION &&
    entry.workspaceId === workspaceId
  );
}

type Edit = { start: number; removed: number; replacement: string[] };

function singleEdit(base: string[], changed: string[]): Edit {
  let start = 0;
  while (base[start] === changed[start] && start < base.length) start += 1;
  let baseEnd = base.length;
  let changedEnd = changed.length;
  while (
    baseEnd > start &&
    changedEnd > start &&
    base[baseEnd - 1] === changed[changedEnd - 1]
  ) {
    baseEnd -= 1;
    changedEnd -= 1;
  }
  return {
    start,
    removed: baseEnd - start,
    replacement: changed.slice(start, changedEnd),
  };
}

export type MarkdownMerge =
  | { status: "clean"; content: string }
  | { status: "conflict"; base: string; disk: string; editor: string };

export function mergeMarkdown(
  base: string,
  disk: string,
  editor: string,
): MarkdownMerge {
  if (disk === editor || disk === base)
    return { status: "clean", content: editor };
  if (editor === base) return { status: "clean", content: disk };
  const baseLines = base.split("\n");
  const edits = [
    singleEdit(baseLines, disk.split("\n")),
    singleEdit(baseLines, editor.split("\n")),
  ].sort((left, right) => right.start - left.start);
  const [later, earlier] = edits;
  if (
    !later ||
    !earlier ||
    earlier.start === later.start ||
    earlier.start + earlier.removed > later.start
  )
    return { status: "conflict", base, disk, editor };
  const merged = [...baseLines];
  for (const edit of edits)
    merged.splice(edit.start, edit.removed, ...edit.replacement);
  return { status: "clean", content: merged.join("\n") };
}
