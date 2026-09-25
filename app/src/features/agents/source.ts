import { ipcClient, type IpcClient } from "../../lib/ipc";
import type { ManagedAgentSessionRecord } from "../../lib/ipc/types";
import type {
  AgentCommandResult,
  AgentEvent,
  AgentSession,
  AgentSessionSource,
  AgentStartResult,
} from "./types";

const unavailable = (message: string): AgentCommandResult => ({
  ok: false,
  error: {
    code: "agent.runtime_unavailable",
    message,
    retryable: false,
  },
});

/**
 * Safe renderer fallback until the desktop agent bridge is connected.
 *
 * Keeping this as a real source (instead of sprinkling null checks through
 * the UI) makes availability explicit and prevents fabricated "running"
 * sessions from appearing in a fresh workspace.
 */
export const unavailableAgentSessionSource: AgentSessionSource = {
  availability: {
    status: "unavailable",
    reason: "The local agent runtime is not connected yet.",
  },
  probe() {
    return Promise.resolve(this.availability);
  },
  list() {
    return Promise.resolve([]);
  },
  start() {
    return Promise.resolve({
      ok: false,
      error: {
        code: "agent.runtime_unavailable",
        message: "The local agent runtime is not connected yet.",
        retryable: false,
      },
    });
  },
  sendMessage() {
    return Promise.resolve(
      unavailable("The local agent runtime is not connected yet."),
    );
  },
  subscribe() {
    return () => undefined;
  },
  cancel() {
    return Promise.resolve(
      unavailable("The local agent runtime is not connected yet."),
    );
  },
  decideApproval() {
    return Promise.resolve(
      unavailable("The local agent runtime is not connected yet."),
    );
  },
};

export function createIpcAgentSessionSource(
  client: IpcClient,
): AgentSessionSource {
  return {
    availability: { status: "available" },
    async probe() {
      const result = await client.agents.probe();
      if (!result.ok)
        return {
          status: "unavailable",
          reason: result.error.message,
          checkedAt: new Date().toISOString(),
        };
      return {
        status:
          result.data.status === "available" ? "available" : "unavailable",
        ...(result.data.reason ? { reason: result.data.reason } : {}),
        checkedAt: new Date().toISOString(),
      };
    },
    async list(workspaceId) {
      const result = await client.agents.list(workspaceId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data.map(toAgentSession);
    },
    async start(workspaceId, objective, sandbox): Promise<AgentStartResult> {
      const result = await client.agents.start({
        workspaceId,
        objective,
        sandbox,
      });
      return result.ok
        ? { ok: true, session: toAgentSession(result.data) }
        : { ok: false, error: result.error };
    },
    async sendMessage(workspaceId, sessionId, message) {
      const result = await client.agents.message({
        workspaceId,
        sessionId,
        message,
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    subscribe(workspaceId, listener) {
      let disposed = false;
      let polling = false;
      const seen = new Set<string>();
      const poll = async () => {
        if (disposed || polling) return;
        polling = true;
        try {
          const result = await client.agents.list(workspaceId);
          if (!result.ok) return;
          for (const record of result.data) {
            for (const event of toAgentSession(record).events ?? []) {
              if (seen.has(event.id)) continue;
              seen.add(event.id);
              listener(event);
            }
          }
        } finally {
          polling = false;
        }
      };
      void poll();
      const timer = window.setInterval(() => void poll(), 900);
      return () => {
        disposed = true;
        window.clearInterval(timer);
      };
    },
    async cancel(workspaceId, sessionId) {
      const result = await client.agents.cancel({ workspaceId, sessionId });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    async decideApproval(workspaceId, sessionId, approvalId, decision) {
      if (decision !== "approved" && decision !== "denied")
        return {
          ok: false,
          error: {
            code: "agent.invalid_approval_decision",
            message: "Only approve and deny are supported for live requests.",
            retryable: false,
          },
        };
      const result = await client.agents.decideApproval({
        workspaceId,
        sessionId,
        approvalId,
        decision,
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
  };
}

export const ipcAgentSessionSource = createIpcAgentSessionSource(ipcClient);

/** Stable name for consumers that want the desktop source explicitly. */
export const defaultAgentSessionSource = ipcAgentSessionSource;

export function createUnavailableAgentSessionSource(
  reason = "The local agent runtime is not connected yet.",
): AgentSessionSource {
  return {
    ...unavailableAgentSessionSource,
    availability: { status: "unavailable", reason },
    probe() {
      return Promise.resolve({ status: "unavailable", reason });
    },
    start() {
      return Promise.resolve({
        ok: false,
        error: {
          code: "agent.runtime_unavailable",
          message: reason,
          retryable: false,
        },
      });
    },
    sendMessage() {
      return Promise.resolve(unavailable(reason));
    },
    cancel() {
      return Promise.resolve(unavailable(reason));
    },
    decideApproval() {
      return Promise.resolve(unavailable(reason));
    },
  };
}

function toAgentSession(record: ManagedAgentSessionRecord): AgentSession {
  const session: AgentSession = {
    id: record.id,
    workspaceId: record.workspaceId,
    provider: record.provider,
    mode: record.mode,
    profileId: record.profileId,
    packetId: record.packetId,
    objective: record.objective,
    roots: record.roots,
    state: record.state,
    assistantText: record.assistantText,
    pendingApprovals: record.pendingApprovals,
    fileChanges: record.fileChanges.map((change) => ({
      path: change.path,
      ...(change.beforeHash ? { beforeHash: change.beforeHash } : {}),
      ...(change.afterHash ? { afterHash: change.afterHash } : {}),
    })),
    validations: record.validations,
    events: record.events.filter(isAgentEvent),
    ...(record.lastActivityAt ? { lastActivityAt: record.lastActivityAt } : {}),
    ...(record.currentAction ? { currentAction: record.currentAction } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
  return session;
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.occurredAt === "string" &&
    [
      "assistant",
      "tool",
      "approval",
      "file_change",
      "validation",
      "lifecycle",
      "error",
    ].includes(String(event.type))
  );
}
