import type { AgentCommandResult, AgentSessionSource } from "./types";

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
  list() {
    return Promise.resolve([]);
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

/** Stable name for consumers that want the default source explicitly. */
export const defaultAgentSessionSource = unavailableAgentSessionSource;

export function createUnavailableAgentSessionSource(
  reason = "The local agent runtime is not connected yet.",
): AgentSessionSource {
  return {
    ...unavailableAgentSessionSource,
    availability: { status: "unavailable", reason },
    cancel() {
      return Promise.resolve(unavailable(reason));
    },
    decideApproval() {
      return Promise.resolve(unavailable(reason));
    },
  };
}
