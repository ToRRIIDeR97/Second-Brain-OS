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

export type RendererDiagnostic = {
  source: string;
  message: string;
  stack?: string;
};

export type ThemeMode = "auto" | "light" | "dark";

export type InspectorTab =
  | "overview"
  | "relationships"
  | "source"
  | "context"
  | "history"
  | "provider"
  | "actions";

export type ShellLayout = {
  version: number;
  navigatorWidth: number;
  inspectorWidth: number;
  navigatorOpen: boolean;
  inspectorOpen: boolean;
  drawerOpen: boolean;
  drawerHeight: number;
  themeMode: ThemeMode;
  inspectorTab: InspectorTab;
  /** v1 compatibility: accepted when reading legacy shell state only. */
  sidebarWidth?: number;
};

/** Canonical persisted shell payload after the v1 → v2 migration. */
export type ShellLayoutV2 = Omit<ShellLayout, "version"> & { version: 2 };

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

export type ImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export type FileAttachmentCreateRequest = {
  path: WorkspacePath;
  bytesBase64: string;
};

export type FileAttachmentCreateResult = {
  path: WorkspacePath;
  mediaType: ImageMediaType;
  sizeBytes: number;
};

export type FileAttachmentReadResult = {
  base64: string;
  mediaType: ImageMediaType;
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
  rootPath?: string | null;
  kind: WorkspaceKind;
  trustLevel: WorkspaceTrustLevel;
  canRead: boolean;
  canWrite: boolean;
  canUseTerminal: boolean;
};

export type WorkspaceRegistration = {
  name: string;
  /** Display only. Native access is granted by rootGrantId. */
  rootPath: string;
  rootGrantId?: string;
  kind: WorkspaceKind;
  trustLevel: WorkspaceTrustLevel;
};

export type RootSelection = {
  grantId: string;
  displayPath: string;
  suggestedName: string;
};

export type ProjectStatus = "active" | "paused" | "archived";

export type ProjectLocation = {
  workspaceId: string;
  /** Display alias only. Runtime access always resolves workspaceId. */
  displayPath: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  outcome: string;
  templateId?: string | null;
  instructions: string;
  status: ProjectStatus;
  progressPercent: number;
  nextMilestone?: string | null;
  blocker?: string | null;
  tags: string[];
  location?: ProjectLocation | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectLocationInput =
  | { mode: "none" }
  | { mode: "existingWorkspace"; workspaceId: string }
  | {
      mode: "rootSelection";
      grantId: string;
      trustLevel: WorkspaceTrustLevel;
    };

export type ProjectCreateRequest = {
  brainWorkspaceId: string;
  name: string;
  outcome: string;
  templateId?: string | null;
  instructions: string;
  tags: string[];
  location: ProjectLocationInput;
};

export type ProjectPatch = {
  name?: string;
  outcome?: string;
  templateId?: string | null;
  instructions?: string;
  status?: ProjectStatus;
  progressPercent?: number;
  nextMilestone?: string | null;
  blocker?: string | null;
  tags?: string[];
  location?: ProjectLocation | null;
};

export type ActivityCategory =
  | "all"
  | "attention"
  | "runs"
  | "changes"
  | "history";

export type ActivityListRequest = {
  workspaceId?: string | null;
  projectId?: string | null;
  category?: ActivityCategory | null;
  cursor?: string | null;
  limit?: number | null;
};

export type ActivityItem = {
  id: string;
  eventType: string;
  timestamp: string;
  workspaceId?: string | null;
  correlationId: string;
  actorType: string;
  category: Exclude<ActivityCategory, "all">;
  payload: Record<string, unknown> | null;
};

export type ActivityPage = {
  items: ActivityItem[];
  nextCursor?: string | null;
};

export type PlannerScheduleRecord =
  | { kind: "date_only"; date: string }
  | { kind: "all_day"; date: string }
  | {
      kind: "exact";
      startEpochSeconds: number;
      endEpochSeconds?: number | null;
      timezone: string;
    };

export type PlannerItemRecord = {
  id: string;
  kind: "task" | "milestone" | "focus_block" | "calendar";
  title: string;
  details?: string | null;
  location?: string | null;
  schedule?: PlannerScheduleRecord | null;
  status: "open" | "in_progress" | "completed" | "archived";
  projectId?: string | null;
  source: "local" | "markdown" | "provider";
  sourceLink?: WorkspacePath & {
    startLine?: number | null;
    endLine?: number | null;
    explicitTaskId?: string | null;
  };
  providerLink?: { provider: string; objectId: string } | null;
  recurrenceRule?: string | null;
  syncStatus:
    | "local_only"
    | "pending"
    | "synced"
    | "offline"
    | "stale"
    | "conflict"
    | "failed"
    | "error";
  conflictMessage?: string | null;
  createdAtEpochSeconds: number;
  updatedAtEpochSeconds: number;
};

export type PlannerListRequest = {
  brainWorkspaceId: string;
  projectId?: string | null;
  range?: {
    startDate: string;
    endDate: string;
    startEpochSeconds: number;
    endEpochSeconds: number;
  };
};

export type PlannerItemDraftRecord = {
  kind?: PlannerItemRecord["kind"];
  title: string;
  details?: string | null;
  location?: string | null;
  schedule?: PlannerScheduleRecord | null;
  projectId?: string | null;
};

export type PlannerItemPatchRecord = {
  title?: string;
  details?: string;
  clearDetails?: boolean;
  location?: string;
  clearLocation?: boolean;
  schedule?: PlannerScheduleRecord;
  clearSchedule?: boolean;
  status?: PlannerItemRecord["status"];
  projectId?: string;
  clearProject?: boolean;
};

export type PlannerCreateRequest = {
  brainWorkspaceId: string;
  draft: PlannerItemDraftRecord;
  syncTarget?: "local" | "google";
};

export type PlannerUpdateRequest = {
  brainWorkspaceId: string;
  itemId: string;
  patch: PlannerItemPatchRecord;
};

export type PlannerDeleteRequest = {
  brainWorkspaceId: string;
  itemId: string;
};

export type AgentProviderProbeRecord = {
  provider: "codex";
  status: "available" | "unavailable";
  version?: string | null;
  reason?: string | null;
};

export type ManagedAgentSandbox = "read_only" | "workspace_write";

export type GoogleConsentMode = "read_only" | "read_write";

export type IntegrationSettings = {
  version: 1;
  google: {
    oauthClientId: string | null;
    consentMode: GoogleConsentMode;
    calendarEnabled: boolean;
    tasksEnabled: boolean;
  };
  codex: {
    defaultSandbox: ManagedAgentSandbox;
  };
};

export type IntegrationSettingsUpdate = {
  google: IntegrationSettings["google"] & {
    oauthClientSecret?: string | null;
  };
  codex: IntegrationSettings["codex"];
};

export type GoogleConnectionStatus = {
  state:
    | "not_configured"
    | "disconnected"
    | "connecting"
    | "connected"
    | "error";
  connected: boolean;
  clientSecretConfigured: boolean;
  consentMode: GoogleConsentMode;
  calendarEnabled: boolean;
  tasksEnabled: boolean;
  lastSyncedAt?: string | null;
  message: string;
};

export type GoogleSyncSummary = {
  calendarItems: number;
  taskItems: number;
  taskLists: number;
  lastSyncedAt: string;
};

export type ManagedAgentStartRequest = {
  workspaceId: string;
  objective: string;
  sandbox: ManagedAgentSandbox;
};

export type ManagedAgentSessionRequest = {
  workspaceId: string;
  sessionId: string;
};

export type ManagedAgentMessageRequest = ManagedAgentSessionRequest & {
  message: string;
};

export type ManagedAgentApprovalRequest = ManagedAgentSessionRequest & {
  approvalId: string;
  decision: "approved" | "denied";
};

/** The backend payload is structurally validated by the feature model. */
export type ManagedAgentSessionRecord = {
  id: string;
  workspaceId: string;
  provider: "codex";
  mode: "managed";
  profileId: string;
  packetId: string;
  objective: string;
  roots: {
    readable: { projectId: string; relativePath: string }[];
    writable: { projectId: string; relativePath: string }[];
    writableProjectId: string;
  };
  state:
    | "created"
    | "starting"
    | "running"
    | "waiting"
    | "canceling"
    | "completed"
    | "failed"
    | "recoverable";
  assistantText: string;
  pendingApprovals: {
    approvalId: string;
    riskClass: string;
    summary: string;
    target: string;
    decision: "pending" | "approved" | "denied" | "expired" | "canceled";
  }[];
  fileChanges: { path: string; beforeHash?: string; afterHash?: string }[];
  validations: {
    validationId: string;
    commandId: string;
    passed: boolean;
    summary: string;
  }[];
  events: unknown[];
  lastActivityAt?: string | null;
  currentAction?: string | null;
  error?: { code: string; message: string; retryable: boolean } | null;
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

export type GitWorkspaceDiff = {
  staged: boolean;
  patch: string;
  truncated: boolean;
};

export type GitFileDiff = {
  path: string;
  oldPath?: string;
  kind: "staged" | "unstaged" | "untracked" | "deleted" | "renamed";
  staged: boolean;
  original?: string | null;
  modified?: string | null;
  originalLabel: string;
  modifiedLabel: string;
  fallback?: "binary" | "oversized" | null;
  binary: boolean;
  oversized: boolean;
};

export type ToolLanguage = "typescript" | "javascript" | "python" | "rust";

export type LanguageToolStatus = {
  id: string;
  name: string;
  available: boolean;
  version?: string;
};

export type LanguageFormatResult = {
  content: string;
  tool: string;
};

export type LanguageDiagnostic = {
  relativePath: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source: string;
  code?: string;
};

export type LspServerKind = "type_script" | "python" | "ruff" | "rust";

export type LspSessionSummary = {
  id: string;
  workspaceId: string;
  server: LspServerKind;
  rootUri: string;
  status: "running" | "exited" | "stopped" | "failed";
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
