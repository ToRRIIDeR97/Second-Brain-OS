import { describe, expect, test } from "bun:test"
import { agentRuns, agentRunStatus } from "./activity-runs"

describe("agent run status", () => {
  test("puts pending approvals ahead of the run state", () => {
    expect(agentRunStatus({ type: "busy" }, 2)).toBe("approval")
    expect(agentRunStatus(undefined, 1)).toBe("approval")
  })

  test("maps busy and retry sessions", () => {
    expect(agentRunStatus({ type: "busy" }, 0)).toBe("running")
    expect(agentRunStatus({ type: "retry", attempt: 1, message: "rate limited", next: 0 }, 0)).toBe("retrying")
  })

  test("leaves idle sessions without a status", () => {
    expect(agentRunStatus({ type: "idle" }, 0)).toBeUndefined()
    expect(agentRunStatus(undefined, 0)).toBeUndefined()
  })

  test("lists active runs first and keeps recency order", () => {
    const status = { b: "running", d: "approval" } as const
    const runs = agentRuns(["a", "b", "c", "d"], (id) => status[id as keyof typeof status])
    expect(runs.map((run) => run.record)).toEqual(["b", "d", "a", "c"])
    expect(runs.map((run) => run.status)).toEqual(["running", "approval", undefined, undefined])
  })
})
