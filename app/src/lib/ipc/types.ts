/**
 * IPC contracts are intentionally kept in one place. Feature code should use
 * IpcClient methods instead of calling Tauri directly.
 */
export type AppError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type CommandSuccess<T> = {
  contract: "ipc_result";
  version: 1;
  ok: true;
  data: T;
  correlationId: string;
};

export type CommandFailure = {
  contract: "ipc_result";
  version: 1;
  ok: false;
  error: AppError;
  correlationId: string;
};

export type CommandResult<T> = CommandSuccess<T> | CommandFailure;

export type ShellLayout = {
  version: number;
  sidebarWidth: number;
  inspectorWidth: number;
  inspectorOpen: boolean;
  drawerOpen: boolean;
};

export type EventEnvelope<T> = {
  schemaVersion: number;
  event: string;
  correlationId: string;
  jobId?: string;
  data: T;
};

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type JobProgress = {
  jobId: string;
  state: JobState;
  completed: number;
  total?: number;
  message?: string;
};

export type JobCancellation = {
  jobId: string;
  cancelled: boolean;
};

export type WorkspacePath = {
  workspaceId: string;
  relativePath: string;
};

export type FileReadResult = {
  content: string;
  contentHash: string;
  revisionId: string;
  encoding: "utf8" | "utf8Bom" | "unsupported";
  eol: "lf" | "crlf" | "mixed";
  sizeBytes: number;
};

export type FileWriteRequest = {
  path: WorkspacePath;
  content: string;
  baseHash?: string;
  baseContent?: string;
  actor: { actorType: string; actorId: string };
  correlationId: string;
  operationId?: string;
};

export type FileWriteResult = {
  operationId: string;
  revisionId: string;
  contentHash: string;
  sizeBytes: number;
  mergeNotice: boolean;
};

export type WorkspaceKind = "brain" | "project" | "collection";
export type WorkspaceTrustLevel =
  | "untrusted"
  | "trusted_read_only"
  | "trusted"
  | "restricted";

export type WorkspaceSummary = {
  id: string;
  name: string;
  kind: WorkspaceKind;
  trustLevel: WorkspaceTrustLevel;
  canRead: boolean;
  canWrite: boolean;
  canUseTerminal: boolean;
};

export type WorkspaceRegistration = {
  name: string;
  rootPath: string;
  kind: WorkspaceKind;
  trustLevel: WorkspaceTrustLevel;
};

export type WorkspaceDirectoryEntry = {
  name: string;
  relativePath: string;
  kind: "directory" | "file" | "symlink" | "other";
  sizeBytes: number;
  modifiedUnixSeconds?: number;
  ignored: boolean;
};

export type WorkspaceDirectoryPage = {
  entries: WorkspaceDirectoryEntry[];
  nextCursor?: number;
};

export type GitWorkspaceChange = {
  path: string;
  status: string;
  staged: boolean;
};

export type GitWorkspaceStatus = {
  branch?: string;
  changes: GitWorkspaceChange[];
};

export type WorkspaceSearchResult = {
  id: string;
  title: string;
  path: string;
  snippet: string;
  authority: string;
  indexState: "current" | "stale" | "failed";
  reasonCodes: string[];
};

export type WorkspaceSearchResponse = {
  results: WorkspaceSearchResult[];
  structuredPlan: string;
};

export type WorkspaceGraphNode = {
  id: string;
  label: string;
  type: string;
  authority:
    | "explicit_user"
    | "explicit_file"
    | "provider_authoritative"
    | "agent_confirmed"
    | "model_inferred"
    | "heuristic_inferred";
  confidence: number;
  source: WorkspacePath;
};

export type WorkspaceGraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  authority: WorkspaceGraphNode["authority"];
  confidence: number;
};

export type WorkspaceGraphPage = {
  nodes: WorkspaceGraphNode[];
  edges: WorkspaceGraphEdge[];
  truncated: boolean;
};

export type NativeTerminalPreset =
  | "zsh"
  | "bash"
  | "fish"
  | "power_shell"
  | "codex"
  | "claude";

export type NativeTerminalSession = {
  id: string;
  workspaceId: string;
  preset: NativeTerminalPreset;
  status: "running" | "exited";
  cwd: { relativePath: string; reliable: boolean };
  size: { columns: number; rows: number };
  exitCode: number | null;
  protected: boolean;
  busy: boolean;
  childProcesses: number;
  bufferedBytes: number;
  droppedBytes: number;
};

export type NativeTerminalOutput = {
  content: string;
  remainingBytes: number;
  droppedBytes: number;
};

export const IPC_ERROR_CODES = {
  malformedEnvelope: "IPC_MALFORMED_ENVELOPE",
  unavailable: "IPC_UNAVAILABLE",
} as const;

export function isCommandResult<T>(value: unknown): value is CommandResult<T> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.contract !== "ipc_result" ||
    candidate.version !== 1 ||
    typeof candidate.ok !== "boolean" ||
    typeof candidate.correlationId !== "string"
  ) {
    return false;
  }

  if (candidate.ok) return "data" in candidate;
  const error = candidate.error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).code === "string" &&
    typeof (error as Record<string, unknown>).message === "string" &&
    typeof (error as Record<string, unknown>).retryable === "boolean"
  );
}

export function protocolError(
  message: string,
  details?: Record<string, unknown>,
): CommandFailure {
  const error: AppError = {
    code: IPC_ERROR_CODES.malformedEnvelope,
    message,
    retryable: false,
  };
  if (details) error.details = details;
  return {
    contract: "ipc_result",
    version: 1,
    ok: false,
    error,
    correlationId: `ipc-${Date.now().toString(36)}`,
  };
}
