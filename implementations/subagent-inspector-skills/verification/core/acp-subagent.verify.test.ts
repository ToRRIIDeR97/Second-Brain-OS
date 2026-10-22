import { describe, expect, test } from "bun:test"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"

const update = (value: Record<string, unknown>) => ({ method: "session/update", params: { sessionId: "s1", update: value } })
const meta = (id: string, title: string) => ({ "opencode/child-session": { id, parentID: "s1", depth: 1, title } })
const spawn = (id: string, description: string) => [
  update({ sessionUpdate: "tool_call", toolCallId: id, name: "subagent", kind: "think", status: "pending", rawInput: {} }),
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status: "in_progress",
    rawInput: { agent: "general", description, prompt: description },
  }),
]
const done = (id: string) =>
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: `${id} done` } }],
  })

type Acp = { transcript?: Array<Record<string, unknown>>; usage?: Record<string, unknown>; truncated?: boolean }
function results(notifications: ReturnType<typeof update>[]) {
  const state = AcpHarness.acpState()
  const events = notifications.flatMap((item) => AcpHarness.parseAcpNotification(item, "s1", state))
  const byId = new Map<string, Acp>()
  for (const event of events as unknown as Array<{ type: string; id: string; providerMetadata?: { acp?: Acp } }>) {
    if (event.type === "tool-result") byId.set(event.id, event.providerMetadata?.acp ?? {})
  }
  return { state, byId }
}

describe("verify AC-4 / AC-5 subagent capture", () => {
  test("AC-4 parallel subagents keep separate transcripts", () => {
    const { byId } = results([
      ...spawn("a", "Alpha"),
      ...spawn("b", "Beta"),
      update({ sessionUpdate: "agent_message_chunk", messageId: "x", content: { type: "text", text: "from alpha" }, _meta: meta("ca", "Alpha") }),
      update({ sessionUpdate: "agent_message_chunk", messageId: "y", content: { type: "text", text: "from beta" }, _meta: meta("cb", "Beta") }),
      done("a"),
      done("b"),
    ])
    expect(byId.get("a")?.transcript).toEqual([{ type: "text", text: "from alpha" }])
    expect(byId.get("b")?.transcript).toEqual([{ type: "text", text: "from beta" }])
  })

  test("AC-4 a new message after a tool starts a new text entry", () => {
    const m = meta("c1", "Alpha")
    const { byId } = results([
      ...spawn("a", "Alpha"),
      update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "one" }, _meta: m }),
      update({ sessionUpdate: "tool_call", toolCallId: "c1:t", kind: "execute", status: "failed", rawInput: { command: "false" }, rawOutput: "exit 1", _meta: m }),
      update({ sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "two" }, _meta: m }),
      done("a"),
    ])
    const transcript = byId.get("a")?.transcript ?? []
    expect(transcript.map((entry) => entry.type)).toEqual(["text", "tool", "text"])
    expect(transcript[1]).toMatchObject({ status: "failed", title: "false" })
  })

  test("AC-4 very long subagent text is cut and marked truncated", () => {
    const m = meta("c1", "Alpha")
    const chunk = "z".repeat(30_000)
    const { byId } = results([
      ...spawn("a", "Alpha"),
      ...[1, 2, 3, 4, 5].map(() => update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: chunk }, _meta: m })),
      done("a"),
    ])
    const acp = byId.get("a")!
    const length = (acp.transcript ?? []).reduce((sum, entry) => sum + String(entry.text ?? "").length, 0)
    expect(acp.truncated).toBe(true)
    expect(length).toBeLessThanOrEqual(100_000)
  })

  test("AC-5 the parent's own usage update still counts for the parent", () => {
    const { state, byId } = results([
      ...spawn("a", "Alpha"),
      update({ sessionUpdate: "usage_update", used: 900, size: 1000 }),
      done("a"),
    ])
    expect(state.usage).toMatchObject({ used: 900, size: 1000 })
    expect(byId.get("a")?.usage).toBeUndefined()
  })

  test("AC-5 child usage without cost keeps used and size only", () => {
    const { byId } = results([
      ...spawn("a", "Alpha"),
      update({ sessionUpdate: "usage_update", used: 10, size: 100, _meta: meta("c1", "Alpha") }),
      done("a"),
    ])
    expect(byId.get("a")?.usage).toEqual({ used: 10, size: 100 })
  })
})
