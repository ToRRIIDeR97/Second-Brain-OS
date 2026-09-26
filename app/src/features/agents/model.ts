import type {
  AgentApproval,
  AgentEvent,
  AgentFileChange,
  AgentSession,
  AgentState,
  AgentWorkspaceState,
  ApprovalDecision,
  AgentValidation,
} from "./types";

export type AgentAction =
  | { type: "session/open"; session: AgentSession }
  | { type: "session/activate"; id: string }
  | { type: "session/state"; id: string; state: AgentState }
  | { type: "session/event"; id: string; event: AgentEvent }
  | { type: "session/cancel"; id: string }
  | {
      type: "approval/decide";
      sessionId: string;
      approvalId: string;
      decision: Exclude<ApprovalDecision, "pending">;
    };

export function agentReducer(
  state: AgentWorkspaceState,
  action: AgentAction,
): AgentWorkspaceState {
  switch (action.type) {
    case "session/open":
      if (
        action.session.workspaceId !== state.workspaceId ||
        state.sessions.some(({ id }) => id === action.session.id)
      )
        return state;
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        activeSessionId: action.session.id,
      };
    case "session/activate":
      return state.sessions.some(({ id }) => id === action.id)
        ? { ...state, activeSessionId: action.id }
        : state;
    case "session/state":
      return updateSession(state, action.id, (session) => ({
        ...session,
        state: action.state,
      }));
    case "session/event":
      return updateSession(state, action.id, (session) =>
        applyEvent(session, action.event),
      );
    case "session/cancel":
      return updateSession(state, action.id, (session) =>
        session.state === "completed" || session.state === "failed"
          ? session
          : { ...session, state: "canceling" },
      );
    case "approval/decide":
      return updateSession(state, action.sessionId, (session) => {
        if (
          !session.pendingApprovals.some(
            ({ approvalId }) => approvalId === action.approvalId,
          )
        )
          return session;
        const pendingApprovals = session.pendingApprovals.filter(
          ({ approvalId }) => approvalId !== action.approvalId,
        );
        return {
          ...session,
          state: session.state === "waiting" ? "running" : session.state,
          pendingApprovals,
        };
      });
  }
}

function applyEvent(session: AgentSession, event: AgentEvent): AgentSession {
  const events = [...(session.events ?? [])];
  if (events.some(({ id }) => id === event.id)) return session;
  events.push(event);
  const next: AgentSession = {
    ...session,
    events,
    lastActivityAt: event.occurredAt,
  };

  switch (event.type) {
    case "assistant":
      return {
        ...next,
        assistantText: `${session.assistantText}${session.assistantText ? "\n" : ""}${event.text}`,
      };
    case "lifecycle":
      return withCurrentAction(
        { ...next, state: event.state },
        event.summary ??
          (event.state === "completed" || event.state === "failed"
            ? undefined
            : session.currentAction),
      );
    case "approval": {
      const alreadyPending = session.pendingApprovals.some(
        ({ approvalId }) => approvalId === event.approval.approvalId,
      );
      return {
        ...next,
        state:
          event.approval.decision === "pending" ? "waiting" : session.state,
        pendingApprovals: alreadyPending
          ? session.pendingApprovals
          : [...session.pendingApprovals, event.approval],
      };
    }
    case "file_change":
      return {
        ...next,
        fileChanges: appendUniqueFileChange(session.fileChanges, event.change),
      };
    case "validation":
      return {
        ...next,
        validations: appendUniqueValidation(
          session.validations,
          event.validation,
        ),
      };
    case "error":
      return {
        ...next,
        state: session.state === "completed" ? session.state : "failed",
        error: {
          code: event.code,
          message: event.message,
          retryable: event.retryable,
        },
      };
    case "tool":
      return withCurrentAction(
        { ...next },
        event.phase === "completed" || event.phase === "failed"
          ? undefined
          : event.summary,
      );
  }
}

function withCurrentAction(
  session: AgentSession,
  currentAction: string | undefined,
): AgentSession {
  if (currentAction === undefined) {
    delete session.currentAction;
  } else {
    session.currentAction = currentAction;
  }
  return session;
}

function appendUniqueFileChange(
  changes: AgentFileChange[],
  change: AgentFileChange,
): AgentFileChange[] {
  return changes.some(
    ({ path, afterHash }) =>
      path === change.path && afterHash === change.afterHash,
  )
    ? changes
    : [...changes, change];
}

function appendUniqueValidation(
  validations: AgentValidation[],
  validation: AgentValidation,
): AgentValidation[] {
  return validations.some(
    ({ validationId }) => validationId === validation.validationId,
  )
    ? validations
    : [...validations, validation];
}

function updateSession(
  state: AgentWorkspaceState,
  id: string,
  update: (session: AgentSession) => AgentSession,
): AgentWorkspaceState {
  if (!state.sessions.some((session) => session.id === id)) return state;
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id ? update(session) : session,
    ),
  };
}

export function statusLabel(state: AgentState): string {
  return state === "recoverable"
    ? "Recoverable"
    : state.slice(0, 1).toUpperCase() + state.slice(1);
}

export function rootLabel(projectId: string, relativePath: string): string {
  return `${projectId}:${relativePath}`;
}

export function approvalSummary(approval: AgentApproval): string {
  return `${approval.summary} · ${approval.riskClass} · ${approval.target}`;
}
