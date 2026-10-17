// Independent verification for AC-1, AC-2, AC-4. Same contract as acceptance/, different cases.
// Run from opencode/packages/session-ui:
//   bun test ../../../implementations/session-view/verification/step-kind.verify.test.ts
import { describe, expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { stepOf, summarizeTurn } from "../../../opencode/packages/session-ui/src/components/step-kind"

let seq = 0
function tool(name: string, input: Record<string, unknown>, status: "completed" | "error" | "running" | "pending" = "completed") {
  const state =
    status === "completed"
      ? { status, input, output: "", title: "", metadata: {}, time: { start: 0, end: 1 } }
      : status === "error"
        ? { status, input, error: "exit 1", time: { start: 0, end: 1 } }
        : status === "running"
          ? { status, input, time: { start: 0 } }
          : { status, input, raw: "" }
  return { id: `p${++seq}`, sessionID: "s", messageID: "m", type: "tool", callID: `c${seq}`, tool: name, state } as unknown as ToolPart
}

describe("AC-4 harness-specific input shapes", () => {
  test("a command given as an argument array is joined with spaces", () => {
    expect(stepOf(tool("acp_execute", { command: ["git", "status", "--short"] }))).toEqual({
      kind: "run",
      target: "git status --short",
    })
  })

  test("Codex file_change keyed by path uses the first path", () => {
    expect(stepOf(tool("file_change", { changes: { "src/y.ts": { kind: "add" }, "src/z.ts": {} } }))).toEqual({
      kind: "edit",
      target: "src/y.ts",
    })
  })

  test("an ACP call with only a title falls back to the title", () => {
    expect(stepOf(tool("acp_read", { title: "Read README.md" }))).toEqual({ kind: "read", target: "Read README.md" })
  })

  test("an ACP kind with no mapping is other", () => {
    expect(stepOf(tool("acp_think", { title: "Planning" })).kind).toBe("other")
  })
})

describe("AC-1 name collisions and missing targets", () => {
  test("built-in names win over MCP server prefixes", () => {
    const servers = { mcpServers: ["apply", "web"] }
    expect(stepOf(tool("apply_patch", { filePath: "a.ts" }), servers).kind).toBe("edit")
    expect(stepOf(tool("web_search", { query: "q" }), servers).kind).toBe("fetch")
  })

  test("the MCP tool part keeps underscores after the server prefix", () => {
    expect(stepOf(tool("linear_create_issue", {}), { mcpServers: ["linear"] })).toEqual({
      kind: "mcp",
      target: "linear · create_issue",
    })
  })

  test("without a matching server an underscored name is other", () => {
    expect(stepOf(tool("linear_create_issue", {}), { mcpServers: ["github"] })).toEqual({
      kind: "other",
      target: "linear_create_issue",
    })
  })

  test("a known tool with no usable input has no target", () => {
    expect(stepOf(tool("read", {}))).toEqual({ kind: "read" })
  })
})

describe("AC-2 summary edge cases", () => {
  test("an empty turn has no counts and no duration", () => {
    expect(summarizeTurn([])).toEqual({ counts: {}, failed: 0, running: 0 })
  })

  test("duration needs both start and end", () => {
    expect(summarizeTurn([tool("read", { filePath: "a" })], { startedAt: 5 }).durationMs).toBeUndefined()
  })

  test("pending counts as running, and failed steps still count toward their kind", () => {
    const summary = summarizeTurn([
      tool("edit", { filePath: "a" }, "error"),
      tool("edit", { filePath: "b" }),
      tool("task", { description: "x" }, "pending"),
    ] as Part[])
    expect(summary.counts).toEqual({ edit: 2, subagent: 1 })
    expect(summary.failed).toBe(1)
    expect(summary.running).toBe(1)
  })
})
