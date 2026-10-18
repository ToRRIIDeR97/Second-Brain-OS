// Acceptance tests for the step-kind contract (AC-1, AC-2, AC-4).
// Run from opencode/packages/session-ui:
//   bun test ../../../implementations/session-view/acceptance/step-kind.test.ts
import { describe, expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { stepOf, summarizeTurn } from "../../../opencode/packages/session-ui/src/components/step-kind"

let seq = 0
function tool(name: string, input: Record<string, unknown> = {}, status: "completed" | "error" | "running" = "completed") {
  const state =
    status === "completed"
      ? { status, input, output: "", title: "", metadata: {}, time: { start: 0, end: 1 } }
      : status === "error"
        ? { status, input, error: "boom", time: { start: 0, end: 1 } }
        : { status, input, time: { start: 0 } }
  return {
    id: `prt_${++seq}`,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: `call_${seq}`,
    tool: name,
    state,
  } as unknown as ToolPart
}

describe("AC-1 stepOf maps built-in tools to a kind and target", () => {
  test("read, search, edit, run, fetch, skill, subagent", () => {
    expect(stepOf(tool("read", { filePath: "src/a.ts" }))).toEqual({ kind: "read", target: "src/a.ts" })
    expect(stepOf(tool("grep", { pattern: "useSessions(" }))).toEqual({ kind: "search", target: "useSessions(" })
    expect(stepOf(tool("glob", { pattern: "**/*.tsx" }))).toEqual({ kind: "search", target: "**/*.tsx" })
    expect(stepOf(tool("edit", { filePath: "src/b.ts" }))).toEqual({ kind: "edit", target: "src/b.ts" })
    expect(stepOf(tool("write", { filePath: "src/c.ts" }))).toEqual({ kind: "edit", target: "src/c.ts" })
    expect(stepOf(tool("bash", { command: "bun test" }))).toEqual({ kind: "run", target: "bun test" })
    expect(stepOf(tool("webfetch", { url: "https://example.com" }))).toEqual({
      kind: "fetch",
      target: "https://example.com",
    })
    expect(stepOf(tool("skill", { name: "unslop" }))).toEqual({ kind: "skill", target: "unslop" })
    expect(stepOf(tool("task", { description: "Map subscribers", subagent_type: "explore" }))).toEqual({
      kind: "subagent",
      target: "Map subscribers",
    })
  })

  test("todo and question keep their own kinds", () => {
    expect(stepOf(tool("todowrite", { todos: [] })).kind).toBe("todo")
    expect(stepOf(tool("question", { questions: [] })).kind).toBe("question")
  })

  test("an MCP tool is recognised by a configured server prefix", () => {
    expect(stepOf(tool("github_list_pull_requests", { state: "open" }), { mcpServers: ["github"] })).toEqual({
      kind: "mcp",
      target: "github · list_pull_requests",
    })
  })

  test("an unknown tool is other, with its name as the target", () => {
    expect(stepOf(tool("mystery_tool", {}))).toEqual({ kind: "other", target: "mystery_tool" })
  })
})

describe("AC-4 Codex and ACP tool names map to the same kinds", () => {
  test("Codex app-server items", () => {
    expect(stepOf(tool("command_execution", { command: "git status", cwd: "C:/repo" }))).toEqual({
      kind: "run",
      target: "git status",
    })
    expect(stepOf(tool("mcp_tool_call", { server: "github", tool: "list_pull_requests", arguments: {} }))).toEqual({
      kind: "mcp",
      target: "github · list_pull_requests",
    })
    expect(stepOf(tool("web_search", { query: "acp protocol" }))).toEqual({ kind: "fetch", target: "acp protocol" })
    expect(stepOf(tool("file_change", { changes: [{ path: "src/x.ts", kind: "update" }] }))).toEqual({
      kind: "edit",
      target: "src/x.ts",
    })
  })

  test("ACP tool kinds", () => {
    expect(stepOf(tool("acp_read", { path: "README.md" }))).toEqual({ kind: "read", target: "README.md" })
    expect(stepOf(tool("acp_execute", { command: "ls" }))).toEqual({ kind: "run", target: "ls" })
    expect(stepOf(tool("acp_edit", { path: "a.md" }))).toEqual({ kind: "edit", target: "a.md" })
    expect(stepOf(tool("acp_search", { query: "todo" }))).toEqual({ kind: "search", target: "todo" })
    expect(stepOf(tool("acp_fetch", { url: "https://x.dev" }))).toEqual({ kind: "fetch", target: "https://x.dev" })
  })
})

describe("AC-2 summarizeTurn", () => {
  test("counts steps by kind, failures and running steps", () => {
    const parts = [
      tool("read", { filePath: "a" }),
      tool("read", { filePath: "b" }),
      tool("grep", { pattern: "x" }),
      tool("bash", { command: "bun test" }, "error"),
      tool("bash", { command: "bun run build" }, "running"),
    ]
    const summary = summarizeTurn(parts, { startedAt: 1_000, endedAt: 135_000 })
    expect(summary.counts).toEqual({ read: 2, search: 1, run: 2 })
    expect(summary.failed).toBe(1)
    expect(summary.running).toBe(1)
    expect(summary.durationMs).toBe(134_000)
  })

  test("ignores text and reasoning parts", () => {
    const text = { id: "prt_t", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "hi" } as unknown as Part
    const summary = summarizeTurn([text, tool("read", { filePath: "a" })])
    expect(summary.counts).toEqual({ read: 1 })
    expect(summary.failed).toBe(0)
    expect(summary.running).toBe(0)
  })
})
