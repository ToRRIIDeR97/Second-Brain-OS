import { describe, expect, test } from "bun:test"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"
import { codexInputItems, codexState, parseCodexNotification } from "../../../../opencode/packages/core/src/harness"

const acp = (value: Record<string, unknown>) => ({ method: "session/update", params: { sessionId: "s1", update: value } })
const png = "data:image/png;base64,aGVsbG8="

describe("AC-10 attachments reach harnesses", () => {
  test("Codex gets a pasted image as image input and a local image as localImage", () => {
    const items = codexInputItems("look", [
      { mediaType: "image/png", data: png, filename: "a.png" },
      { mediaType: "image/jpeg", data: "file:///Users/me/shot.jpg", filename: "shot.jpg" },
    ])
    expect(items).toEqual([
      { type: "text", text: "look", text_elements: [] },
      { type: "image", url: png },
      { type: "localImage", path: "/Users/me/shot.jpg" },
    ])
  })

  test("an ACP agent that accepts images gets an image block, and a local file a resource link", () => {
    const blocks = AcpHarness.acpPromptBlocks(
      "look",
      [
        { mediaType: "image/png", data: png, filename: "a.png" },
        { mediaType: "application/pdf", data: "file:///Users/me/r.pdf", filename: "r.pdf" },
      ],
      { image: true },
    )
    expect(blocks).toEqual([
      { type: "text", text: "look" },
      { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      { type: "resource_link", uri: "file:///Users/me/r.pdf", name: "r.pdf", mimeType: "application/pdf" },
    ])
  })
})

describe("AC-11 ACP edit diffs are kept", () => {
  test("diff content becomes providerMetadata.acp.diffs", () => {
    const state = AcpHarness.acpState()
    const events = [
      acp({ sessionUpdate: "tool_call", toolCallId: "e1", kind: "edit", title: "Edit a.ts", rawInput: { file_path: "a.ts" } }),
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "e1",
        status: "completed",
        content: [{ type: "diff", path: "/w/a.ts", oldText: "one", newText: "two" }],
      }),
    ].flatMap((item) => AcpHarness.parseAcpNotification(item, "s1", state))
    const result = events.find((event) => event.type === "tool-result")
    expect(result).toMatchObject({ providerMetadata: { acp: { diffs: [{ path: "/w/a.ts", oldText: "one", newText: "two" }] } } })
  })
})

describe("AC-12 plans become todo lists", () => {
  test("an ACP plan update", () => {
    const events = AcpHarness.parseAcpNotification(
      acp({ sessionUpdate: "plan", entries: [{ content: "Write tests", status: "in_progress", priority: "high" }] }),
      "s1",
      AcpHarness.acpState(),
    )
    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-result"])
    expect(events[0]).toMatchObject({
      name: "todowrite",
      providerExecuted: true,
      input: { todos: [{ content: "Write tests", status: "in_progress" }] },
    })
  })

  test("a Codex plan update", () => {
    const events = parseCodexNotification(
      { method: "turn/plan/updated", params: { turnId: "t1", plan: [{ step: "Fix bug", status: "inProgress" }] } },
      codexState(),
    )
    expect(events[0]).toMatchObject({ name: "todowrite", input: { todos: [{ content: "Fix bug", status: "in_progress" }] } })
  })
})

describe("AC-13 Claude Code subagents", () => {
  test("a Task call is a subagent and its child tool stays inside it", () => {
    const state = AcpHarness.acpState()
    const events = [
      acp({ sessionUpdate: "tool_call", toolCallId: "sub", name: "Task", kind: "think", status: "in_progress", rawInput: { description: "Find usages", subagent_type: "Explore" } }),
      acp({ sessionUpdate: "tool_call", toolCallId: "inner", kind: "search", status: "in_progress", rawInput: { pattern: "x" }, _meta: { claudeCode: { parentToolUseId: "sub" } } }),
    ].flatMap((item) => AcpHarness.parseAcpNotification(item, "s1", state))
    const calls = events.filter((event) => event.type === "tool-call")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ id: "sub", name: "acp_subagent" })
  })
})

describe("AC-14 long harness output keeps its end", () => {
  test("ACP output over 32,000 characters keeps the first 8,000 and the last 24,000", () => {
    const state = AcpHarness.acpState()
    const text = `${"a".repeat(8_000)}${"m".repeat(20_000)}${"z".repeat(24_000)}`
    const events = [
      acp({ sessionUpdate: "tool_call", toolCallId: "x", kind: "execute", rawInput: { command: "make" } }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "x", status: "completed", content: [{ type: "content", content: { type: "text", text } }] }),
    ].flatMap((item) => AcpHarness.parseAcpNotification(item, "s1", state))
    const value = (events.find((event) => event.type === "tool-result") as { result: { value: string } }).result.value
    expect(value.startsWith("a".repeat(8_000))).toBe(true)
    expect(value.endsWith("z".repeat(24_000))).toBe(true)
    expect(value).toContain("20000")
    expect(value).not.toContain("m".repeat(10))
  })
})

describe("AC-15 Codex file changes are readable", () => {
  test("each change is its path and diff, not JSON", () => {
    const events = parseCodexNotification(
      {
        method: "item/completed",
        params: { item: { id: "f1", type: "fileChange", changes: [{ path: "src/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-one\n+two" }] } },
      },
      codexState(),
    )
    const value = (events.find((event) => event.type === "tool-result") as { result: { value: string } }).result.value
    expect(value).toContain("src/a.ts (update)")
    expect(value).toContain("-one\n+two")
    expect(value).not.toContain("\\n")
  })
})
