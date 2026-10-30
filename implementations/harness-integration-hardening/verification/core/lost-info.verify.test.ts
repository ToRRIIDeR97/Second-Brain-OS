import { describe, expect, test } from "bun:test"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"
import { codexInputItems, codexState, parseCodexNotification } from "../../../../opencode/packages/core/src/harness"

const acp = (value: Record<string, unknown>) => ({ method: "session/update", params: { sessionId: "s1", update: value } })

describe("verify AC-10", () => {
  test("an ACP agent without image support gets only text for a pasted image; non-image data is left out", () => {
    const blocks = AcpHarness.acpPromptBlocks(
      "t",
      [
        { mediaType: "image/png", data: "data:image/png;base64,AAAA", filename: "a.png" },
        { mediaType: "application/pdf", data: "data:application/pdf;base64,AAAA", filename: "b.pdf" },
      ],
      {},
    )
    expect(blocks).toEqual([{ type: "text", text: "t" }])
  })

  test("Codex leaves out non-image files", () => {
    expect(codexInputItems("t", [{ mediaType: "application/pdf", data: "file:///x/r.pdf", filename: "r.pdf" }])).toEqual([
      { type: "text", text: "t", text_elements: [] },
    ])
  })
})

describe("verify AC-11", () => {
  test("several diffs in one call are all kept", () => {
    const state = AcpHarness.acpState()
    const events = [
      acp({ sessionUpdate: "tool_call", toolCallId: "e", kind: "edit", rawInput: { x: 1 } }),
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "e",
        status: "completed",
        content: [
          { type: "diff", path: "/w/a", oldText: null, newText: "new" },
          { type: "diff", path: "/w/b", oldText: "x", newText: "y" },
        ],
      }),
    ].flatMap((item) => AcpHarness.parseAcpNotification(item, "s1", state))
    const result = events.find((event) => event.type === "tool-result") as { providerMetadata?: { acp?: { diffs?: unknown[] } } }
    expect(result.providerMetadata?.acp?.diffs).toHaveLength(2)
  })
})

describe("verify AC-12", () => {
  test("two plan updates in one turn are two separate todo calls", () => {
    const state = AcpHarness.acpState()
    const first = AcpHarness.parseAcpNotification(acp({ sessionUpdate: "plan", entries: [{ content: "a", status: "pending" }] }), "s1", state)
    const second = AcpHarness.parseAcpNotification(acp({ sessionUpdate: "plan", entries: [{ content: "a", status: "completed" }] }), "s1", state)
    const ids = [...first, ...second].filter((event) => event.type === "tool-call").map((event) => (event as { id: string }).id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe("verify AC-13", () => {
  test("a lowercase agent call is a subagent, and an unknown parent leaves the tool at the top level", () => {
    const state = AcpHarness.acpState()
    const events = [
      acp({ sessionUpdate: "tool_call", toolCallId: "a1", name: "agent", kind: "think", status: "in_progress", rawInput: { description: "d" } }),
      acp({ sessionUpdate: "tool_call", toolCallId: "t2", kind: "read", status: "in_progress", rawInput: { path: "x" }, _meta: { claudeCode: { parentToolUseId: "nope" } } }),
    ].flatMap((item) => AcpHarness.parseAcpNotification(item, "s1", state))
    const calls = events.filter((event) => event.type === "tool-call") as { id: string; name: string }[]
    expect(calls.map((call) => `${call.id}:${call.name}`)).toEqual(["a1:acp_subagent", "t2:acp_read"])
  })
})

describe("verify AC-14", () => {
  test("short output is unchanged and long Codex command output keeps its end", () => {
    const short = parseCodexNotification(
      { method: "item/completed", params: { item: { id: "c", type: "commandExecution", command: "ls", aggregatedOutput: "ok" } } },
      codexState(),
    )
    expect((short.find((event) => event.type === "tool-result") as { result: { value: string } }).result.value).toBe("ok")
    const long = parseCodexNotification(
      {
        method: "item/completed",
        params: { item: { id: "d", type: "commandExecution", command: "make", aggregatedOutput: `${"s".repeat(40_000)}FAILED: 3 tests` } },
      },
      codexState(),
    )
    const value = (long.find((event) => event.type === "tool-result") as { result: { value: string } }).result.value
    expect(value.endsWith("FAILED: 3 tests")).toBe(true)
    expect(value.length).toBeLessThan(33_000)
  })
})

describe("verify AC-15", () => {
  test("a new file without diff text still names its path and kind", () => {
    const events = parseCodexNotification(
      { method: "item/completed", params: { item: { id: "f", type: "fileChange", changes: [{ path: "new.md", kind: "add" }] } } },
      codexState(),
    )
    const value = (events.find((event) => event.type === "tool-result") as { result: { value: string } }).result.value
    expect(value).toContain("new.md (add)")
    expect(value.trim().startsWith("{")).toBe(false)
  })
})
