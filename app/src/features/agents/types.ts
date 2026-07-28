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
  error?: { code: string; message: string; retryable: boolean };
};

export type AgentWorkspaceState = {
  workspaceId: string;
  sessions: AgentSession[];
  activeSessionId: string | null;
};
