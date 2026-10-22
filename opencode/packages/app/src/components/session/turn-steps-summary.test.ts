import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { subagentLanes, tickerStep } from "./turn-steps-summary"

const tool = (
  id: string,
  status: "pending" | "running" | "completed" | "error",
  name = "read",
  metadata?: Record<string, unknown>,
) => ({ id, type: "tool", tool: name, state: { status, input: {} }, metadata }) as unknown as Part
const text = (id: string) => ({ id, type: "text", text: "" }) as unknown as Part

describe("tickerStep", () => {
  test("shows the latest step still in progress", () => {
    const parts = [tool("a", "completed"), tool("b", "running"), text("t"), tool("c", "completed")]
    expect(tickerStep(parts)?.id).toBe("b")
  })

  test("shows the latest step when none is in progress", () => {
    expect(tickerStep([tool("a", "completed"), tool("b", "error")])?.id).toBe("b")
  })

  test("leaves subagents to their lanes", () => {
    expect(tickerStep([tool("a", "completed"), tool("s", "running", "acp_subagent")])?.id).toBe("a")
  })

  test("is empty without tool steps", () => {
    expect(tickerStep([text("t")])).toBeUndefined()
  })
})

describe("subagentLanes", () => {
  test("reads ACP steps and picks the step in progress as current", () => {
    const steps = [
      { tool: "acp_execute", title: "ls -la", status: "completed" },
      { tool: "acp_read", title: "/w/a.txt", status: "in_progress" },
      { tool: "acp_read", status: "completed" },
      { broken: true },
    ]
    const lanes = subagentLanes([
      tool("r", "completed"),
      tool("s", "running", "acp_subagent", { acpSteps: steps }),
      tool("t", "completed", "task"),
    ])
    expect(lanes.map((lane) => [lane.part.id, lane.running, lane.steps.length])).toEqual([
      ["s", true, 3],
      ["t", false, 0],
    ])
    expect(lanes[0]!.current).toEqual({ tool: "acp_read", title: "/w/a.txt", status: "in_progress" })
  })
})
