export type AgentProvider = "codex" | "claude";
export type AgentMode = "managed" | "visible";
export type AgentState =
  | "created"
  | "starting"
  | "running"
  | "waiting"
  | "canceling"
  | "completed"
  | "failed"
  | "recoverable";
export type ApprovalDecision =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "canceled";

export type AgentRoot = {
  projectId: string;
  relativePath: string;
};

export type AgentRoots = {
  readable: AgentRoot[];
  writable: AgentRoot[];
  writableProjectId: string;
};

export type AgentApproval = {
  approvalId: string;
  riskClass: string;
  summary: string;
  target: string;
  decision: ApprovalDecision;
};

export type AgentFileChange = {
  path: string;
  beforeHash?: string;
  afterHash?: string;
};

export type AgentValidation = {
  validationId: string;
  commandId: string;
  passed: boolean;
  summary: string;
};

/**
 * Normalized, redacted activity emitted by an agent adapter.
 *
 * Agent output is intentionally represented as data rather than a raw log.
 * Providers may add details at the adapter boundary, but the renderer only
 * receives one of these bounded event shapes.
 */
export type AgentEvent =
  | {
      id: string;
      sessionId?: string;
      occurredAt: string;
      type: "assistant";
      text: string;
    }
  | {
      id: string;
      sessionId?: string;
      occurredAt: string;
      type: "tool";
      tool: string;
      summary: string;
      phase?: "started" | "completed" | "failed";
    }
  | {
      id: string;
      sessionId?: string;
      occurredAt: string;
      type: "approval";
      approval: AgentApproval;
    }
  | {
      id: string;
      sessionId?: string;
      occurredAt: string;
      type: "file_change";
      change: AgentFileChange;
      operation?: "created" | "modified" | "renamed" | "deleted";
    }
  | {
      id: string;
      sessionId?: string;
      occurredAt: string;
      type: "validation";
      validation: AgentValidation;
    }
  | {
      id: string;
      sessionId?: string;
      occurredAt: string;
      type: "lifecycle";
      state: AgentState;
      summary?: string;
    }
  | {
      id: string;
      sessionId?: string;
      occurredAt: string;
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
    };

export type AgentAvailabilityStatus = "available" | "degraded" | "unavailable";

export type AgentAvailability = {
  status: AgentAvailabilityStatus;
  /** A user-facing reason is required for unavailable/degraded states. */
  reason?: string;
  checkedAt?: string;
};

export type AgentSourceError = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type AgentCommandResult =
  | { ok: true }
  | { ok: false; error: AgentSourceError };

export type AgentStartResult =
  | { ok: true; session: AgentSession }
  | { ok: false; error: AgentSourceError };

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * Renderer seam for a managed/visible agent runtime.
 *
 * Implementations are expected to normalize provider events before exposing
 * them here. The default implementation below is deliberately unavailable;
 * it returns no sessions and failed command results until an IPC adapter is
 * connected, so the UI never invents a running session.
 */
export interface AgentSessionSource {
  availability: AgentAvailability;
  probe: () => Promise<AgentAvailability>;
  list: (workspaceId: string) => Promise<AgentSession[]>;
  start: (
    workspaceId: string,
    objective: string,
    sandbox: "read_only" | "workspace_write",
  ) => Promise<AgentStartResult>;
  sendMessage: (
    workspaceId: string,
    sessionId: string,
    message: string,
  ) => Promise<AgentCommandResult>;
  subscribe: (workspaceId: string, listener: AgentEventListener) => () => void;
  cancel: (
    workspaceId: string,
    sessionId: string,
  ) => Promise<AgentCommandResult>;
  decideApproval: (
    workspaceId: string,
    sessionId: string,
    approvalId: string,
    decision: Exclude<ApprovalDecision, "pending">,
  ) => Promise<AgentCommandResult>;
}

export type AgentSession = {
  id: string;
  workspaceId: string;
  provider: AgentProvider;
  mode: AgentMode;
  profileId: string;
  packetId: string;
  objective: string;
  roots: AgentRoots;
  state: AgentState;
  assistantText: string;
  pendingApprovals: AgentApproval[];
  fileChanges: AgentFileChange[];
  validations: AgentValidation[];
  /** Ordered, normalized stream used by the structured session timeline. */
  events?: AgentEvent[];
  lastActivityAt?: string;
  currentAction?: string;
  error?: { code: string; message: string; retryable: boolean };
};

export type AgentWorkspaceState = {
  workspaceId: string;
  sessions: AgentSession[];
  activeSessionId: string | null;
};
