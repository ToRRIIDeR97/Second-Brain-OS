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
