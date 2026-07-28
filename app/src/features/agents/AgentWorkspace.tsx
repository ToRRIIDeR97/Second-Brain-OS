import { useMemo } from "react";
import {
  agentReducer,
  approvalSummary,
  rootLabel,
  statusLabel,
  type AgentAction,
} from "./model";
import type { AgentWorkspaceState, ApprovalDecision } from "./types";

export type AgentWorkspaceProps = {
  state: AgentWorkspaceState;
  onChange: (state: AgentWorkspaceState, action: AgentAction) => void;
  onCancel?: (sessionId: string) => void;
  onApprove?: (
    sessionId: string,
    approvalId: string,
    decision: Exclude<ApprovalDecision, "pending">,
  ) => void;
};

export function AgentWorkspace({
  state,
  onChange,
  onCancel,
  onApprove,
}: AgentWorkspaceProps) {
  const active = useMemo(
    () => state.sessions.find(({ id }) => id === state.activeSessionId),
    [state.activeSessionId, state.sessions],
  );
  const dispatch = (action: AgentAction) => {
    onChange(agentReducer(state, action), action);
  };

  return (
    <section aria-labelledby="agent-workspace-title">
      <h1 id="agent-workspace-title">Agent sessions</h1>
      <div role="tablist" aria-label="Agent sessions">
        {state.sessions.map((session) => (
          <button
            type="button"
            role="tab"
            aria-selected={session.id === state.activeSessionId}
            key={session.id}
            onClick={() => {
              dispatch({ type: "session/activate", id: session.id });
            }}
          >
            {session.provider} · {statusLabel(session.state)}
          </button>
        ))}
      </div>

      {active ? (
        <AgentSessionPanel
          session={active}
          onCancel={() => {
            dispatch({ type: "session/cancel", id: active.id });
            onCancel?.(active.id);
          }}
          onApprove={(approvalId, decision) => {
            dispatch({
              type: "approval/decide",
              sessionId: active.id,
              approvalId,
              decision,
            });
            onApprove?.(active.id, approvalId, decision);
          }}
        />
      ) : (
        <p>No agent sessions are open.</p>
      )}
    </section>
  );
}

function AgentSessionPanel({
  session,
  onCancel,
  onApprove,
}: {
  session: AgentWorkspaceState["sessions"][number];
  onCancel: () => void;
  onApprove: (
    approvalId: string,
    decision: Exclude<ApprovalDecision, "pending">,
  ) => void;
}) {
  const terminal = session.state === "completed" || session.state === "failed";
  return (
    <article aria-label={`${session.provider} session ${session.id}`}>
      <header>
        <p>
          <strong>{session.provider}</strong> · {session.mode} ·{" "}
          {statusLabel(session.state)}
        </p>
        <p>Profile: {session.profileId}</p>
        <p>Objective: {session.objective}</p>
        <p>Context packet: {session.packetId}</p>
      </header>

      <section aria-labelledby="agent-readable-roots">
        <h2 id="agent-readable-roots">Readable roots</h2>
        <ul>
          {session.roots.readable.map((root) => (
            <li key={`${root.projectId}:${root.relativePath}`}>
              {rootLabel(root.projectId, root.relativePath)}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="agent-writable-roots">
        <h2 id="agent-writable-roots">Writable roots</h2>
        <p>Writable project: {session.roots.writableProjectId}</p>
        <ul>
          {session.roots.writable.map((root) => (
            <li key={`${root.projectId}:${root.relativePath}`}>
              {rootLabel(root.projectId, root.relativePath)}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="agent-approvals">
        <h2 id="agent-approvals">Approval requests</h2>
        {session.pendingApprovals.length === 0 ? (
          <p>No pending approvals.</p>
        ) : (
          <ul>
            {session.pendingApprovals.map((approval) => (
              <li key={approval.approvalId}>
                <span>{approvalSummary(approval)}</span>{" "}
                <button
                  type="button"
                  onClick={() => {
                    onApprove(approval.approvalId, "approved");
                  }}
                >
                  Approve
                </button>{" "}
                <button
                  type="button"
                  onClick={() => {
                    onApprove(approval.approvalId, "denied");
                  }}
                >
                  Deny
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" disabled={terminal} onClick={onCancel}>
        Cancel session
      </button>
      {session.error ? (
        <p role="alert">
          {session.error.code}: {session.error.message}
        </p>
      ) : null}
      <p aria-live="polite">Assistant activity</p>
      <pre aria-label="Assistant activity">
        {session.assistantText || "No assistant activity yet."}
      </pre>
      {session.fileChanges.length > 0 ? (
        <section aria-labelledby="agent-file-changes">
          <h2 id="agent-file-changes">File changes</h2>
          <ul>
            {session.fileChanges.map((change) => (
              <li key={`${change.path}:${change.afterHash ?? ""}`}>
                {change.path}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
