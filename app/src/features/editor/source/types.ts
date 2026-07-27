export type SourceEncoding = "utf8" | "utf8Bom" | "unsupported";
export type SourceEol = "lf" | "crlf" | "mixed";
export type ExternalChange =
  | "none"
  | "modified"
  | "deleted"
  | "renamed"
  | "permissionChanged";
export type EditorStatus =
  | "opening"
  | "clean"
  | "dirty"
  | "saving"
  | "conflict";

export type EditorResource = WorkspacePath & {
  resourceId: string;
  modelUri: string;
  language: string;
  encoding: SourceEncoding;
  eol: SourceEol;
};

export type ViewState = {
  cursorLine: number;
  cursorColumn: number;
  scrollTop: number;
  scrollLeft: number;
};

export type EditorTabState = EditorResource & {
  status: EditorStatus;
  content: string;
  baseHash: string;
  baseRevisionId: string;
  baseContent: string;
  externalChange: ExternalChange;
  openRequest: number;
  viewState?: ViewState;
};

export type EditorState = {
  tabs: Record<string, EditorTabState>;
  order: string[];
  activeResourceId?: string;
  closed: EditorTabState[];
};

export type ConflictState = {
  exists: boolean;
  hash?: string;
  content?: string;
  binary: boolean;
};

export type ConflictPayload = {
  kind:
    | "externalText"
    | "deletedOnDisk"
    | "createdOnDisk"
    | "binaryOnDisk"
    | "concurrentChange";
  base: ConflictState;
  disk: ConflictState;
  editor: ConflictState;
  operationId: string;
};

export type FileEvent = {
  workspaceId: string;
  kind: "created" | "modified" | "deleted" | "renamed";
  path: string;
  oldPath?: string;
  observedHash?: string;
  operationId?: string;
};
import type { WorkspacePath } from "../../../lib/ipc";

export type {
  FileReadResult,
  FileWriteRequest,
  FileWriteResult,
  WorkspacePath,
} from "../../../lib/ipc";
