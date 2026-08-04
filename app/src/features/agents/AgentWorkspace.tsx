import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentReducer,
  approvalSummary,
  rootLabel,
  statusLabel,
  type AgentAction,
} from "./model";
import { unavailableAgentSessionSource } from "./source";
import type {
  AgentAvailability,
  AgentEvent,
  AgentSession,
  AgentSessionSource,
  AgentWorkspaceState,
  ApprovalDecision,
} from "./types";

export type AgentWorkspaceProps = {
  state: AgentWorkspaceState;
  onChange: (state: AgentWorkspaceState, action: AgentAction) => void;
  onCancel?: (sessionId: string) => void;
  onApprove?: (
    sessionId: string,
    approvalId: string,
    decision: Exclude<ApprovalDecision, "pending">,
  ) => void;
  /** Optional managed/visible runtime bridge. */
  sessionSource?: AgentSessionSource;
  /** Alias kept for callers that already use the shorter name. */
  source?: AgentSessionSource;
};

export function AgentWorkspace({
  state,
  onChange,
  onCancel,
  onApprove,
  sessionSource,
  source,
}: AgentWorkspaceProps) {
  const runtime = sessionSource ?? source ?? unavailableAgentSessionSource;
  const [sourceIssue, setSourceIssue] = useState<string>();
  const loadedSource = useRef<AgentSessionSource | undefined>(undefined);
  const loadedWorkspace = useRef<string | undefined>(undefined);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback(
    (action: AgentAction) => {
      const next = agentReducer(stateRef.current, action);
      stateRef.current = next;
      onChange(next, action);
    },
    [onChange],
  );

  // A source is opt-in and never creates a local placeholder session. If a
  // real bridge is supplied, hydrate its existing sessions once per workspace
  // and then consume normalized events from its subscription.
  useEffect(() => {
    if (
      loadedSource.current === runtime &&
      loadedWorkspace.current === state.workspaceId
    )
      return;
    loadedSource.current = runtime;
    loadedWorkspace.current = state.workspaceId;
    if (runtime.availability.status === "unavailable") return;

    let disposed = false;
    void runtime
      .list(state.workspaceId)
      .then((sessions) => {
        if (disposed) return;
        for (const session of sessions) {
          if (
            session.workspaceId === state.workspaceId &&
            !stateRef.current.sessions.some(({ id }) => id === session.id)
          ) {
            dispatch({ type: "session/open", session });
          }
        }
      })
      .catch((error: unknown) => {
        if (!disposed)
          setSourceIssue(
            error instanceof Error
              ? error.message
              : "The agent session list could not be loaded.",
          );
      });
    return () => {
      disposed = true;
    };
  }, [dispatch, runtime, state.workspaceId]);

  useEffect(() => {
    if (runtime.availability.status === "unavailable") return;
    return runtime.subscribe(state.workspaceId, (event) => {
      const sessionId = event.sessionId;
      if (!sessionId) {
        setSourceIssue("An agent event did not identify its session.");
        return;
      }
      dispatch({ type: "session/event", id: sessionId, event });
    });
  }, [dispatch, runtime, state.workspaceId]);

  const active = useMemo(
    () => state.sessions.find(({ id }) => id === state.activeSessionId),
    [state.activeSessionId, state.sessions],
  );

  const command = useCallback(
    async (
      operation: Promise<
        { ok: true } | { ok: false; error: { message: string } }
      >,
    ) => {
      try {
        const result = await operation;
        if (!result.ok) setSourceIssue(result.error.message);
      } catch (error: unknown) {
        setSourceIssue(
          error instanceof Error
            ? error.message
            : "The agent runtime rejected that action.",
        );
      }
    },
    [],
  );

  const unavailable = runtime.availability.status === "unavailable";
  const status = availabilityLabel(runtime.availability);
  const availabilityNotice =
    sourceIssue ??
    (runtime.availability.status === "available"
      ? undefined
      : (runtime.availability.reason ?? status));

  return (
    <section
      className="agent-workspace"
      aria-labelledby="agent-workspace-title"
    >
      <header className="region-heading agent-workspace-heading">
        <div>
          <p className="eyebrow">Agent workspace</p>
          <h1 id="agent-workspace-title">Agent sessions</h1>
        </div>
        <p
          className="agent-runtime-status"
          data-status={runtime.availability.status}
          role="status"
        >
          <span className="status-dot" aria-hidden="true" /> {status}
        </p>
      </header>

      {availabilityNotice ? (
        <p
          className="agent-source-notice"
          role={unavailable ? "status" : "alert"}
        >
          {availabilityNotice}
        </p>
      ) : null}

      {state.sessions.length > 0 ? (
        <div className="agent-session-layout">
          <nav aria-label="Agent sessions" className="agent-session-list">
            <p className="eyebrow">Sessions</p>
            <div role="tablist" aria-label="Agent sessions">
              {state.sessions.map((session) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={session.id === state.activeSessionId}
                  aria-controls={`agent-session-${session.id}`}
                  className="navigator-item"
                  data-selected={session.id === state.activeSessionId}
                  key={session.id}
                  onClick={() => {
                    dispatch({ type: "session/activate", id: session.id });
                  }}
                >
                  <span aria-hidden="true">◈</span>
                  <span>
                    <strong>{session.objective || session.id}</strong>
                    <small>
                      {session.provider} · {statusLabel(session.state)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </nav>

          {active ? (
            <AgentSessionPanel
              session={active}
              onCancel={() => {
                dispatch({ type: "session/cancel", id: active.id });
                onCancel?.(active.id);
                if (!unavailable)
                  void command(runtime.cancel(state.workspaceId, active.id));
              }}
              onApprove={(approvalId, decision) => {
                dispatch({
                  type: "approval/decide",
                  sessionId: active.id,
                  approvalId,
                  decision,
                });
                onApprove?.(active.id, approvalId, decision);
                if (!unavailable)
                  void command(
                    runtime.decideApproval(
                      state.workspaceId,
                      active.id,
                      approvalId,
                      decision,
                    ),
                  );
              }}
            />
          ) : (
            <p className="agent-empty-state" role="status">
              Select a session to inspect its activity.
            </p>
          )}
        </div>
      ) : unavailable ? (
        <div className="agent-empty-state" role="status">
          <h2>Agent runtime unavailable</h2>
          <p>
            No managed session is connected. Connect an approved agent runtime
            to stream session activity here.
          </p>
        </div>
      ) : (
        <div className="agent-empty-state" role="status">
          <h2>No agent sessions are open.</h2>
          <p>
            Start an agent from a note or graph selection to see its activity
            here.
          </p>
        </div>
      )}
    </section>
  );
}

function AgentSessionPanel({
  session,
  onCancel,
  onApprove,
}: {
  session: AgentSession;
  onCancel: () => void;
  onApprove: (
    approvalId: string,
    decision: Exclude<ApprovalDecision, "pending">,
  ) => void;
}) {
  const terminal =
    session.state === "completed" ||
    session.state === "failed" ||
    session.state === "recoverable";
  const events = session.events ?? [];

  return (
    <article
      id={`agent-session-${session.id}`}
      className="agent-session-detail"
      aria-label={`${session.provider} session ${session.id}`}
    >
      <header className="agent-session-header">
        <div>
          <p className="eyebrow">
            {session.provider} · {session.mode}
          </p>
          <h2>{session.objective}</h2>
        </div>
        <p className="agent-session-state" role="status">
          {statusLabel(session.state)}
        </p>
      </header>

      <dl className="agent-session-metadata">
        <div>
          <dt>Profile</dt>
          <dd>{session.profileId}</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>
            <span>Context packet: {session.packetId}</span>
          </dd>
        </div>
        {session.lastActivityAt ? (
          <div>
            <dt>Last activity</dt>
            <dd>{session.lastActivityAt}</dd>
          </div>
        ) : null}
        {session.currentAction ? (
          <div>
            <dt>Current action</dt>
            <dd>{session.currentAction}</dd>
          </div>
        ) : null}
      </dl>

      <section aria-labelledby={`agent-permissions-${session.id}`}>
        <h3 id={`agent-permissions-${session.id}`}>Permissions and roots</h3>
        <div className="agent-permission-grid">
          <div>
            <h4>Readable roots</h4>
            {session.roots.readable.length > 0 ? (
              <ul>
                {session.roots.readable.map((root) => (
                  <li key={`${root.projectId}:${root.relativePath}`}>
                    {rootLabel(root.projectId, root.relativePath)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No readable roots.</p>
            )}
          </div>
          <div>
            <h4>Writable roots</h4>
            <p>Writable project: {session.roots.writableProjectId}</p>
            {session.roots.writable.length > 0 ? (
              <ul>
                {session.roots.writable.map((root) => (
                  <li key={`${root.projectId}:${root.relativePath}`}>
                    {rootLabel(root.projectId, root.relativePath)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No writable roots.</p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby={`agent-approvals-${session.id}`}>
        <div className="region-heading">
          <h3 id={`agent-approvals-${session.id}`}>Approval requests</h3>
          <span>{session.pendingApprovals.length} pending</span>
        </div>
        {session.pendingApprovals.length === 0 ? (
          <p>No pending approvals.</p>
        ) : (
          <ul className="agent-approval-list">
            {session.pendingApprovals.map((approval) => (
              <li key={approval.approvalId}>
                <div>
                  <strong>{approval.summary}</strong>
                  <small>{approvalSummary(approval)}</small>
                </div>
                <div>
                  <button
                    type="button"
                    className="button button-primary button-small"
                    onClick={() => {
                      onApprove(approval.approvalId, "approved");
                    }}
                  >
                    Approve
                  </button>{" "}
                  <button
                    type="button"
                    className="button button-small"
                    onClick={() => {
                      onApprove(approval.approvalId, "denied");
                    }}
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`agent-activity-${session.id}`}>
        <div className="region-heading">
          <h3 id={`agent-activity-${session.id}`}>Assistant activity</h3>
          <span>{events.length} events</span>
        </div>
        {events.length > 0 ? (
          <ol
            className="agent-event-timeline"
            aria-label="Agent activity timeline"
          >
            {events.map((event) => (
              <AgentEventRow event={event} key={event.id} />
            ))}
          </ol>
        ) : (
          <p>{session.assistantText || "No assistant activity yet."}</p>
        )}
      </section>

      <section aria-labelledby={`agent-files-${session.id}`}>
        <h3 id={`agent-files-${session.id}`}>File changes</h3>
        {session.fileChanges.length === 0 ? (
          <p>No file changes recorded.</p>
        ) : (
          <ul>
            {session.fileChanges.map((change) => (
              <li key={`${change.path}:${change.afterHash ?? ""}`}>
                <code>{change.path}</code>
                {change.afterHash ? <small> · {change.afterHash}</small> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`agent-validations-${session.id}`}>
        <h3 id={`agent-validations-${session.id}`}>Validation</h3>
        {session.validations.length === 0 ? (
          <p>No validation results yet.</p>
        ) : (
          <ul>
            {session.validations.map((validation) => (
              <li key={validation.validationId}>
                <span aria-hidden="true">{validation.passed ? "✓" : "!"}</span>{" "}
                {validation.summary} <small>({validation.commandId})</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {session.error ? (
        <p role="alert">
          {session.error.code}: {session.error.message}
          {session.error.retryable ? " You can retry this session." : ""}
        </p>
      ) : null}
      <button
        type="button"
        className="button"
        disabled={terminal}
        onClick={onCancel}
      >
        Cancel session
      </button>
    </article>
  );
}

function AgentEventRow({ event }: { event: AgentEvent }) {
  const body = eventBody(event);
  return (
    <li className={`agent-event agent-event-${event.type}`}>
      <div>
        <strong>{eventLabel(event)}</strong>
        <time dateTime={event.occurredAt}>{event.occurredAt}</time>
      </div>
      <p>{body}</p>
    </li>
  );
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "assistant":
      return "Assistant";
    case "tool":
      return `Tool · ${event.tool}`;
    case "approval":
      return "Approval";
    case "file_change":
      return "File change";
    case "validation":
      return "Validation";
    case "lifecycle":
      return "Lifecycle";
    case "error":
      return "Error";
  }
}

function eventBody(event: AgentEvent): string {
  switch (event.type) {
    case "assistant":
      return event.text;
    case "tool":
      return `${event.summary}${event.phase ? ` · ${event.phase}` : ""}`;
    case "approval":
      return approvalSummary(event.approval);
    case "file_change":
      return `${event.operation ? `${event.operation} · ` : ""}${event.change.path}`;
    case "validation":
      return `${event.validation.passed ? "Passed" : "Failed"} · ${event.validation.summary}`;
    case "lifecycle":
      return event.summary
        ? `${statusLabel(event.state)} · ${event.summary}`
        : statusLabel(event.state);
    case "error":
      return `${event.code}: ${event.message}`;
  }
}

function availabilityLabel(availability: AgentAvailability): string {
  switch (availability.status) {
    case "available":
      return "Runtime connected";
    case "degraded":
      return "Runtime degraded";
    case "unavailable":
      return "Runtime unavailable";
  }
}
