import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { configuredInstances, handleCodexToolCall } from "@opencode-ai/core/harness"
import { ConfigHarness } from "@opencode-ai/core/config/harness"
import { AcpHarness } from "@opencode-ai/core/harness/acp"

const update = (value: Record<string, unknown>) => ({
  method: "session/update",
  params: { sessionId: "s1", update: value },
})

describe("ACP harness", () => {
  test("maps chunks, tools, and the prompt response to stream events", () => {
    const state = AcpHarness.acpState()
    const events = [
      update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "plan" } }),
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } }),
      update({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "ls",
        kind: "execute",
        rawInput: { command: "ls" },
      }),
      update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed", rawOutput: "denied" }),
      { method: "session/update", params: { sessionId: "other", update: { sessionUpdate: "agent_message_chunk" } } },
    ].flatMap((notification) => AcpHarness.parseAcpNotification(notification, "s1", state))
    const finish = AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "max_tokens" }), state)

    expect(events.map((event) => event.type)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-end",
      "tool-call",
      "tool-result",
    ])
    expect(events[7]).toMatchObject({ result: { type: "error", value: '"denied"' } })
    expect(finish.map((event) => event.type)).toEqual(["step-finish", "finish"])
    expect(finish[1]).toMatchObject({ reason: "length" })
  })

  test("maps tool kinds to permission actions", () => {
    expect(["execute", "edit", "move", "search", "fetch", "think", undefined].map(AcpHarness.permissionAction)).toEqual(
      ["bash", "edit", "edit", "read", "webfetch", "acp_tool", "acp_tool"],
    )
  })

  test("keeps built-in harnesses out of the registry", () => {
    const entry = Schema.decodeUnknownSync(ConfigHarness.Instance)
    const instances = configuredInstances([], {
      codex: entry({ driver: "acp", config: { command: "/tmp/other" } }),
      gemini: entry({ driver: "acp", name: "Gemini", config: { command: "gemini" } }),
    })
    expect(instances.map((instance) => `${instance.id}:${instance.driver}`)).toEqual([
      "opencode:opencode",
      "codex:codex",
      "gemini:acp",
    ])
  })

  test("answers Codex dynamic tool calls", async () => {
    const ok = await Effect.runPromise(
      handleCodexToolCall({ tool: "harness_register", namespace: null, arguments: { id: "g" } }, () =>
        Effect.succeed("done"),
      ),
    )
    const unknown = await Effect.runPromise(handleCodexToolCall({ tool: "other" }, () => Effect.succeed("never")))
    expect(ok).toEqual({ success: true, contentItems: [{ type: "inputText", text: "done" }] })
    expect(unknown.success).toBe(false)
  })
})
