import type {
  AgentApproval,
  AgentSession,
  AgentState,
  AgentWorkspaceState,
  ApprovalDecision,
} from "./types";

export type AgentAction =
  | { type: "session/open"; session: AgentSession }
  | { type: "session/activate"; id: string }
  | { type: "session/state"; id: string; state: AgentState }
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
