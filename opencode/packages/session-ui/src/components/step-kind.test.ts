import { describe, expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { stepOf, summarizeTurn } from "./step-kind"

const tool = (name: string, input: Record<string, unknown>, status = "completed") =>
  ({
    id: `prt_${name}`,
    sessionID: "ses",
    messageID: "msg",
    type: "tool",
    callID: "call",
    tool: name,
    state: { status, input, output: "", title: "", metadata: {}, time: { start: 0, end: 1 } },
  }) as unknown as ToolPart

describe("stepOf", () => {
  test("Codex and ACP names share kinds with built-in tools", () => {
    expect(stepOf(tool("command_execution", { command: "git status" }))).toEqual({ kind: "run", target: "git status" })
    expect(stepOf(tool("acp_execute", { command: ["ls", "-la"] }))).toEqual({ kind: "run", target: "ls -la" })
    expect(stepOf(tool("bash", { command: "bun test" }))).toEqual({ kind: "run", target: "bun test" })
  })

  test("MCP tools need a configured server prefix", () => {
    expect(stepOf(tool("github_get_issue", {}), { mcpServers: ["github"] })).toEqual({
      kind: "mcp",
      target: "github · get_issue",
    })
    expect(stepOf(tool("github_get_issue", {})).kind).toBe("other")
  })
})

describe("summarizeTurn", () => {
  test("counts tool parts only", () => {
    const text = { id: "t", type: "text", text: "hi" } as unknown as Part
    expect(summarizeTurn([text, tool("read", { filePath: "a" }), tool("bash", {}, "error")])).toEqual({
      counts: { read: 1, run: 1 },
      failed: 1,
      running: 0,
    })
  })
})
