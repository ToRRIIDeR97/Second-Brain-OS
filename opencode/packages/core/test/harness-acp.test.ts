import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { LLM, Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { Harness } from "@opencode-ai/schema/harness"
import { configuredInstances, continuationFor, renderCodexPrompt } from "@opencode-ai/core/harness"
import { Config } from "@opencode-ai/core/config"
import { ConfigHarness } from "@opencode-ai/core/config/harness"
import { AcpHarness } from "@opencode-ai/core/harness/acp"
import os from "os"
import path from "path"

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

  test("keeps subagent updates out of the parent turn and waits for tool input", () => {
    const state = AcpHarness.acpState()
    const child = { "opencode/child-session": { id: "c1", parentID: "s1", depth: 1, title: "List dir" } }
    const events = [
      update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Spawning." } }),
      update({ sessionUpdate: "tool_call", toolCallId: "sub", name: "subagent", kind: "think", status: "pending", rawInput: {} }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        kind: "think",
        status: "in_progress",
        rawInput: { agent: "explore", description: "List dir", prompt: "Run ls" },
      }),
      update({ sessionUpdate: "tool_call", toolCallId: "c1:t1", kind: "execute", title: "List dir: shell", status: "pending", rawInput: {}, _meta: child }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "c1:t1",
        kind: "execute",
        title: "List dir: ls -la",
        status: "completed",
        rawInput: { command: "ls -la" },
        _meta: child,
      }),
      update({ sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "a.txt" }, _meta: child }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "report" } }],
      }),
      update({ sessionUpdate: "tool_call", toolCallId: "t2", kind: "read", status: "pending", rawInput: { cwd: "/w" } }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "t2",
        kind: "read",
        status: "in_progress",
        locations: [{ path: "/w/a.txt" }],
        rawInput: { path: "/w/a.txt" },
      }),
    ].flatMap((notification) => AcpHarness.parseAcpNotification(notification, "s1", state))

    expect(events.map((event) => event.type)).toEqual([
      "text-start",
      "text-delta",
      "text-end",
      "tool-call",
      "tool-progress",
      "tool-progress",
      "tool-result",
      "tool-call",
    ])
    expect(events[3]).toMatchObject({
      name: "acp_subagent",
      input: { description: "List dir", subagent_type: "explore" },
    })
    expect(events[4]).toMatchObject({
      id: "sub",
      structured: { acp: { steps: [{ tool: "acp_execute", title: "shell", status: "pending" }] } },
    })
    expect(events[6]).toMatchObject({
      providerMetadata: { acp: { steps: [{ tool: "acp_execute", title: "ls -la", status: "completed" }] } },
    })
    expect(events[7]).toMatchObject({ name: "acp_read", input: { path: "/w/a.txt" } })
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
      "opencode-acp:acp",
      "gemini:acp",
    ])
  })

  test("keeps built-in harnesses out of config-file harness entries", () => {
    const entry = Schema.decodeUnknownSync(ConfigHarness.Instance)
    const document = {
      type: "document",
      info: {
        harnesses: {
          opencode: entry({ driver: "acp", name: "Hijack", config: { command: "/tmp/evil" } }),
          "opencode-acp": entry({ driver: "acp", name: "Hijack", config: { command: "/tmp/evil" } }),
          gemini: entry({ driver: "acp", name: "Gemini", config: { command: "gemini" } }),
        },
      },
    } as unknown as Config.Entry
    const instances = configuredInstances([document], {})
    expect(instances.map((instance) => `${instance.id}:${instance.driver}`)).toEqual([
      "opencode:opencode",
      "codex:codex",
      "opencode-acp:acp",
      "gemini:acp",
    ])
    expect(instances.find((instance) => instance.id === "opencode-acp")?.config).toEqual({
      command: "opencode",
      args: ["acp"],
    })
  })

  test("a returning ACP session gets only the messages since its last turn", () => {
    const gemini = Harness.InstanceID.make("gemini")
    const text = (id: string, role: "user" | "assistant", value: string) => ({
      id,
      role,
      content: [{ type: "text" as const, text: value }],
    })
    // Gemini answered u1, then Codex took u2 and u3, then the user switched back to Gemini.
    const metadata = {
      harnessContinuations: {
        gemini: { nativeID: "acp-session", lastSeenMessageID: "u1" },
        codex: { nativeID: "thread", lastSeenMessageID: "u3" },
      },
    }
    const continuation = continuationFor(metadata, gemini, 4)!
    const prompt = renderCodexPrompt(
      LLM.request({
        model: Model.make({ id: "gemini-test", provider: "test", route }),
        messages: [
          text("u1", "user", "Gemini task"),
          text("a1", "assistant", "Gemini reply"),
          text("u2", "user", "Codex task"),
          text("a2", "assistant", "Codex reply"),
          text("u3", "user", "Codex follow-up"),
          text("a3", "assistant", "Codex follow-up reply"),
          text("u4", "user", "Back to Gemini"),
        ],
      }),
      continuation.handoff,
    )

    expect(continuation.nativeID).toBe("acp-session")
    expect(prompt).toContain("since you last participated")
    expect(prompt).toContain("USER:\nCodex task")
    expect(prompt).toContain("ASSISTANT:\nCodex follow-up reply")
    expect(prompt).not.toContain("Gemini task")
    expect(prompt).not.toContain("Gemini reply")
    expect(prompt.endsWith("New user message (respond to this):\nBack to Gemini")).toBe(true)
  })

  test("expands both home-directory separators", () => {
    expect(AcpHarness.expandHome("~")).toBe(os.homedir())
    expect(AcpHarness.expandHome("~/bin/agent")).toBe(path.join(os.homedir(), "bin", "agent"))
    expect(AcpHarness.expandHome("~\\bin\\agent")).toBe(path.join(os.homedir(), "bin\\agent"))
    expect(AcpHarness.expandHome("agent")).toBe("agent")
  })

  // The desktop app runs core under Node, where Bun globals throw at startup. Tests run under Bun and can't see that.
  test("core sources don't use Bun globals", async () => {
    const dir = path.join(import.meta.dir, "../src")
    const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan({ cwd: dir }))
    const offenders = await Promise.all(
      files.map(async (file) => ((await Bun.file(path.join(dir, file)).text()).match(/\bBun\./) ? file : undefined)),
    )
    expect(offenders.filter(Boolean)).toEqual([])
  })
})
