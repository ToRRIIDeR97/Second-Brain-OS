import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { tickerSteps } from "./turn-steps-summary"

const tool = (id: string, status: "pending" | "running" | "completed" | "error") =>
  ({ id, type: "tool", tool: "read", state: { status, input: {} } }) as unknown as Part
const text = (id: string) => ({ id, type: "text", text: "" }) as unknown as Part

describe("tickerSteps", () => {
  test("shows the latest running step with the two steps before it", () => {
    const parts = [
      tool("a", "completed"),
      tool("b", "completed"),
      text("t"),
      tool("c", "completed"),
      tool("d", "running"),
    ]
    expect(tickerSteps(parts).map((part) => part.id)).toEqual(["b", "c", "d"])
  })

  test("anchors on the last in-progress step when later steps finished first", () => {
    const parts = [tool("a", "completed"), tool("b", "pending"), tool("c", "completed")]
    expect(tickerSteps(parts).map((part) => part.id)).toEqual(["a", "b"])
  })

  test("shows the last steps when none is running", () => {
    const parts = [tool("a", "completed"), tool("b", "error"), tool("c", "completed"), tool("d", "completed")]
    expect(tickerSteps(parts).map((part) => part.id)).toEqual(["b", "c", "d"])
  })

  test("is empty without tool steps", () => {
    expect(tickerSteps([text("t")])).toEqual([])
  })
})
