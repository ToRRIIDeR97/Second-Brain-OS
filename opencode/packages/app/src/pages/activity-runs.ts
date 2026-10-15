import type { SessionStatus } from "@opencode-ai/sdk/v2/client"

export type AgentRunStatus = "approval" | "running" | "retrying"

/**
 * Live run state from the synced session status and pending permission requests.
 * Finished and failed runs both settle to `idle`, so an idle session has no status.
 */
export function agentRunStatus(status: SessionStatus | undefined, approvals: number): AgentRunStatus | undefined {
  if (approvals > 0) return "approval"
  if (status?.type === "busy") return "running"
  if (status?.type === "retry") return "retrying"
  return undefined
}

/** Active runs first, keeping the incoming recency order inside each group. */
export function agentRuns<T>(records: T[], status: (record: T) => AgentRunStatus | undefined) {
  const runs = records.map((record) => ({ record, status: status(record) }))
  return [...runs.filter((run) => run.status), ...runs.filter((run) => !run.status)]
}
