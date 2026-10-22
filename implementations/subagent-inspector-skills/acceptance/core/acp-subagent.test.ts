import { describe, expect, test } from "bun:test"
import { Exit } from "effect"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"

const update = (value: Record<string, unknown>) => ({
  method: "session/update",
  params: { sessionId: "s1", update: value },
})
const child = { "opencode/child-session": { id: "c1", parentID: "s1", depth: 1, title: "Find usages" } }
const start = [
  update({ sessionUpdate: "tool_call", toolCallId: "sub", name: "subagent", kind: "think", status: "pending", rawInput: {} }),
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "sub",
    status: "in_progress",
    rawInput: { agent: "explore", description: "Find usages", prompt: "Find harness call sites" },
  }),
]
const finish = update({
  sessionUpdate: "tool_call_update",
  toolCallId: "sub",
  status: "completed",
  content: [{ type: "content", content: { type: "text", text: "3 call sites" } }],
})

const run = (notifications: ReturnType<typeof update>[]) => {
  const state = AcpHarness.acpState()
  const events = notifications.flatMap((item) => AcpHarness.parseAcpNotification(item, "s1", state))
  return { state, events }
}
const resultOf = (events: ReadonlyArray<{ type: string }>) =>
  events.find((event) => event.type === "tool-result") as unknown as {
    providerMetadata?: { acp?: { transcript?: unknown[]; usage?: Record<string, unknown> } }
  }

describe("AC-4 subagent transcript", () => {
  test("AC-4 the result carries the child's text, reasoning and tools in order", () => {
    const { events } = run([
      ...start,
      update({ sessionUpdate: "agent_thought_chunk", messageId: "m1", content: { type: "text", text: "Plan: " }, _meta: child }),
      update({ sessionUpdate: "agent_thought_chunk", messageId: "m1", content: { type: "text", text: "grep" }, _meta: child }),
      update({ sessionUpdate: "tool_call", toolCallId: "c1:t1", kind: "search", title: "Find usages: grep", status: "pending", rawInput: {}, _meta: child }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "c1:t1",
        kind: "search",
        status: "completed",
        rawInput: { command: "grep -rn harness" },
        content: [{ type: "content", content: { type: "text", text: "14 hits" } }],
        _meta: child,
      }),
      update({ sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "Found " }, _meta: child }),
      update({ sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "3." }, _meta: child }),
      finish,
    ])
    const transcript = resultOf(events)?.providerMetadata?.acp?.transcript
    expect(transcript).toEqual([
      { type: "reasoning", text: "Plan: grep" },
      expect.objectContaining({ type: "tool", tool: "acp_search", title: "grep -rn harness", status: "completed", output: "14 hits" }),
      { type: "text", text: "Found 3." },
    ])
  })

  test("AC-4 the child's text never reaches the parent turn", () => {
    const { events } = run([
      ...start,
      update({ sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "child only" }, _meta: child }),
      finish,
    ])
    const deltas = events.filter((event) => event.type === "text-delta") as unknown as { text: string }[]
    expect(deltas.map((delta) => delta.text)).not.toContain("child only")
  })

  test("AC-4 live progress carries the transcript so far", () => {
    const { events } = run([
      ...start,
      update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Looking" }, _meta: child }),
      update({ sessionUpdate: "tool_call", toolCallId: "c1:t1", kind: "read", title: "Find usages: read", status: "pending", rawInput: {}, _meta: child }),
    ])
    const progress = events.filter((event) => event.type === "tool-progress").at(-1) as unknown as {
      structured: { acp: { transcript: unknown[] } }
    }
    expect(progress.structured.acp.transcript).toEqual([
      { type: "text", text: "Looking" },
      expect.objectContaining({ type: "tool", tool: "acp_read", status: "pending" }),
    ])
  })
})

describe("AC-5 subagent usage", () => {
  test("AC-5 a child usage update is kept on the subagent, not the parent turn", () => {
    const { state, events } = run([
      ...start,
      update({ sessionUpdate: "usage_update", used: 41000, size: 200000, cost: { amount: 0.12, currency: "USD" }, _meta: child }),
      finish,
    ])
    expect(resultOf(events)?.providerMetadata?.acp?.usage).toMatchObject({ used: 41000, size: 200000, cost: 0.12 })
    expect(state.usage).toBeUndefined()
    const end = AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "end_turn" }), state)
    expect(JSON.stringify(end)).not.toContain("41000")
  })

  test("AC-5 token fields the harness sends are kept", () => {
    const { events } = run([
      ...start,
      update({
        sessionUpdate: "usage_update",
        used: 5000,
        size: 100000,
        inputTokens: 4000,
        outputTokens: 600,
        cachedReadTokens: 3000,
        cachedWriteTokens: 100,
        _meta: child,
      }),
      finish,
    ])
    expect(resultOf(events)?.providerMetadata?.acp?.usage).toMatchObject({
      inputTokens: 4000,
      outputTokens: 600,
      cachedReadTokens: 3000,
      cachedWriteTokens: 100,
    })
  })
})

describe("AC-10 reported harness commands", () => {
  test("AC-10 available_commands_update is recorded on the turn state", () => {
    const { state, events } = run([
      update({
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "review-pr", description: "Review a PR", input: null }, { name: "init" }],
      }),
    ])
    expect(events).toEqual([])
    expect(state.commands).toEqual([{ name: "review-pr", description: "Review a PR" }, { name: "init" }])
  })
})
