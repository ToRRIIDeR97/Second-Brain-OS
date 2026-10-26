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
      update({
        sessionUpdate: "tool_call",
        toolCallId: "sub",
        name: "subagent",
        kind: "think",
        status: "pending",
        rawInput: {},
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        kind: "think",
        status: "in_progress",
        rawInput: { agent: "explore", description: "List dir", prompt: "Run ls" },
      }),
      update({
        sessionUpdate: "tool_call",
        toolCallId: "c1:t1",
        kind: "execute",
        title: "List dir: shell",
        status: "pending",
        rawInput: {},
        _meta: child,
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "c1:t1",
        kind: "execute",
        title: "List dir: ls -la",
        status: "completed",
        rawInput: { command: "ls -la" },
        _meta: child,
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m2",
        content: { type: "text", text: "a.txt" },
        _meta: child,
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "report" } }],
      }),
      update({
        sessionUpdate: "tool_call",
        toolCallId: "t2",
        kind: "read",
        status: "pending",
        rawInput: { cwd: "/w" },
      }),
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

  test("keeps parallel subagent transcripts separate, including a child that starts with a chunk", () => {
    const state = AcpHarness.acpState()
    const childOf = (id: string, title: string) => ({
      "opencode/child-session": { id, parentID: "s1", depth: 1, title },
    })
    const spawn = (id: string, description: string) => [
      update({
        sessionUpdate: "tool_call",
        toolCallId: id,
        name: "subagent",
        kind: "think",
        status: "pending",
        rawInput: {},
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "in_progress",
        rawInput: { agent: "explore", description, prompt: description },
      }),
    ]
    const done = (id: string) => update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" })
    const events = [
      ...spawn("a", "Alpha"),
      ...spawn("b", "Beta"),
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "from a" },
        _meta: childOf("ca", "Alpha"),
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m2",
        content: { type: "text", text: "from b" },
        _meta: childOf("cb", "Beta"),
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: " again" },
        _meta: childOf("ca", "Alpha"),
      }),
      done("a"),
      done("b"),
    ].flatMap((notification) => AcpHarness.parseAcpNotification(notification, "s1", state))

    const results = events.filter((event) => event.type === "tool-result")
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      id: "a",
      providerMetadata: { acp: { transcript: [{ type: "text", text: "from a again" }] } },
    })
    expect(results[1]).toMatchObject({
      id: "b",
      providerMetadata: { acp: { transcript: [{ type: "text", text: "from b" }] } },
    })
    expect(events.some((event) => event.type === "text-delta")).toBe(false)
  })

  test("checkpoints a subagent when a child message block ends, not on every chunk", () => {
    const state = AcpHarness.acpState()
    const child = { "opencode/child-session": { id: "c1", parentID: "s1", depth: 1, title: "Look" } }
    const chunk = (sessionUpdate: string, messageId: string, text: string) =>
      update({ sessionUpdate, messageId, content: { type: "text", text }, _meta: child })
    const events = [
      update({
        sessionUpdate: "tool_call",
        toolCallId: "sub",
        name: "subagent",
        kind: "think",
        status: "pending",
        rawInput: {},
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        status: "in_progress",
        rawInput: { description: "Look" },
      }),
      chunk("agent_thought_chunk", "m1", "think "),
      chunk("agent_thought_chunk", "m1", "more"),
      chunk("agent_message_chunk", "m2", "answer "),
      chunk("agent_message_chunk", "m2", "done"),
      chunk("agent_message_chunk", "m3", "next"),
    ].flatMap((notification) => AcpHarness.parseAcpNotification(notification, "s1", state))

    const progress = events.filter((event) => event.type === "tool-progress")
    expect(progress).toHaveLength(2)
    expect(progress[0]).toMatchObject({
      structured: {
        acp: {
          transcript: [
            { type: "reasoning", text: "think more" },
            { type: "text", text: "answer " },
          ],
        },
      },
    })
    expect(progress[1]).toMatchObject({
      structured: {
        acp: {
          transcript: [
            { type: "reasoning", text: "think more" },
            { type: "text", text: "answer done" },
            { type: "text", text: "next" },
          ],
        },
      },
    })
  })

  test("caps a subagent transcript and marks it truncated", () => {
    const state = AcpHarness.acpState()
    const child = { "opencode/child-session": { id: "c1", parentID: "s1", depth: 1, title: "Read" } }
    const events = [
      update({
        sessionUpdate: "tool_call",
        toolCallId: "sub",
        name: "subagent",
        kind: "think",
        status: "pending",
        rawInput: {},
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        status: "in_progress",
        rawInput: { description: "Read" },
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "a".repeat(60_000) },
        _meta: child,
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "b".repeat(60_000) },
        _meta: child,
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        messageId: "m2",
        content: { type: "text", text: "dropped" },
        _meta: child,
      }),
      update({ sessionUpdate: "tool_call_update", toolCallId: "sub", status: "completed" }),
    ].flatMap((notification) => AcpHarness.parseAcpNotification(notification, "s1", state))

    const result = events.find((event) => event.type === "tool-result") as unknown as {
      providerMetadata: { acp: { transcript: Array<{ text: string }>; truncated?: boolean } }
    }
    expect(result.providerMetadata.acp.truncated).toBe(true)
    expect(result.providerMetadata.acp.transcript).toHaveLength(1)
    expect(result.providerMetadata.acp.transcript[0]?.text.length).toBe(AcpHarness.TRANSCRIPT_LIMIT)
  })

  test("bounds tool output in a subagent transcript and keeps live progress small", () => {
    const state = AcpHarness.acpState()
    const child = { "opencode/child-session": { id: "c1", parentID: "s1", depth: 1, title: "Read" } }
    const tools = Array.from({ length: 40 }, (_, index) => [
      update({
        sessionUpdate: "tool_call",
        toolCallId: `c1:t${index}`,
        kind: "read",
        title: "Read: read",
        status: "pending",
        rawInput: {},
        _meta: child,
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: `c1:t${index}`,
        kind: "read",
        status: "completed",
        rawInput: { path: `/w/${index}.txt` },
        content: [{ type: "content", content: { type: "text", text: "x".repeat(32_000) } }],
        _meta: child,
      }),
    ]).flat()
    const events = [
      update({
        sessionUpdate: "tool_call",
        toolCallId: "sub",
        name: "subagent",
        kind: "think",
        status: "pending",
        rawInput: {},
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        status: "in_progress",
        rawInput: { description: "Read" },
      }),
      ...tools,
      update({ sessionUpdate: "tool_call_update", toolCallId: "sub", status: "completed" }),
    ].flatMap((notification) => AcpHarness.parseAcpNotification(notification, "s1", state))

    type Entry = { type: string; text?: string; output?: string; status?: string }
    const result = events.find((event) => event.type === "tool-result") as unknown as {
      providerMetadata: { acp: { transcript: Entry[]; truncated?: boolean } }
    }
    const size = (entries: Entry[]) =>
      entries.reduce((total, item) => total + (item.text ?? item.output ?? "").length, 0)
    expect(result.providerMetadata.acp.truncated).toBe(true)
    expect(size(result.providerMetadata.acp.transcript)).toBeLessThanOrEqual(AcpHarness.TRANSCRIPT_LIMIT)
    // Every tool still shows that it ran, even after outputs stop being kept.
    expect(result.providerMetadata.acp.transcript).toHaveLength(40)
    expect(result.providerMetadata.acp.transcript.every((item) => item.status === "completed")).toBe(true)

    const progress = events.filter((event) => event.type === "tool-progress") as unknown as {
      structured: { acp: { transcript: Entry[] } }
    }[]
    expect(progress.length).toBeGreaterThan(0)
    for (const item of progress) {
      expect(item.structured.acp.transcript.length).toBeLessThanOrEqual(AcpHarness.PROGRESS_ENTRIES)
      expect(item.structured.acp.transcript.some((entry) => "output" in entry)).toBe(false)
    }
  })

  test("reports a turn that ends with no output as an error, unless it was cancelled", () => {
    const empty = { stopReason: "end_turn", usage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 } }
    const finish = AcpHarness.finishAcpTurn(Exit.succeed(empty), AcpHarness.acpState())
    const cancelled = AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "cancelled" }), AcpHarness.acpState())

    expect(finish.map((event) => event.type)).toEqual(["provider-error", "step-finish", "finish"])
    expect(finish[2]).toMatchObject({ reason: "error" })
    expect(cancelled.map((event) => event.type)).toEqual(["step-finish", "finish"])
  })

  test("counts a parent usage update for the turn while a child's stays on the subagent", () => {
    const state = AcpHarness.acpState()
    const child = { "opencode/child-session": { id: "c1", parentID: "s1", depth: 1, title: "Read" } }
    ;[
      update({
        sessionUpdate: "tool_call",
        toolCallId: "sub",
        name: "subagent",
        kind: "think",
        status: "pending",
        rawInput: {},
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "sub",
        status: "in_progress",
        rawInput: { description: "Read" },
      }),
      update({ sessionUpdate: "usage_update", used: 900, size: 1000, _meta: child }),
      update({ sessionUpdate: "usage_update", used: 50, size: 1000, cost: { amount: 0.5, currency: "USD" } }),
    ].forEach((notification) => AcpHarness.parseAcpNotification(notification, "s1", state))

    expect(state.usage).toEqual({ used: 50, size: 1000, cost: 0.5 })
    expect(state.tools.get("sub")?.usage).toEqual({ used: 900, size: 1000 })
  })

  test("offers the agent's reasoning levels on its active model only", () => {
    const parsed = AcpHarness.sessionModels({
      configOptions: [
        {
          id: "model",
          category: "model",
          type: "select",
          currentValue: "anthropic/claude",
          options: [{ value: "anthropic/claude", name: "Claude" }, { value: "openai/gpt" }],
        },
        {
          id: "effort",
          category: "thought_level",
          type: "select",
          currentValue: "default",
          options: [{ value: "low" }, { value: "high" }, { value: "default" }],
        },
      ],
    })
    expect(parsed.effort).toEqual({ configId: "effort", current: "default", values: ["low", "high", "default"] })
    expect(parsed.models.map((model) => [model.id, model.reasoningEfforts])).toEqual([
      ["anthropic/claude", ["low", "high"]],
      ["openai/gpt", []],
    ])
    expect(
      AcpHarness.sessionModels({ models: { currentModelId: "a", availableModels: [{ modelId: "a" }] } }).effort,
    ).toBeUndefined()
  })

  test("shows Claude Code's default row as the model it stands for", () => {
    const parsed = AcpHarness.sessionModels({
      configOptions: [
        {
          id: "model",
          category: "model",
          type: "select",
          currentValue: "default",
          options: [
            { value: "default", name: "Default (recommended)", description: "Opus" },
            { value: "opus", name: "Opus 5.5", description: "Opus 5.5 · Best for everyday tasks" },
            { value: "sonnet", name: "Sonnet 5.5" },
          ],
        },
        {
          id: "effort",
          category: "thought_level",
          type: "select",
          currentValue: "default",
          options: [{ value: "default" }, { value: "low" }, { value: "high" }],
        },
      ],
    })
    expect(parsed.current).toBe("opus")
    expect(parsed.models.map((model) => [model.id, model.reasoningEfforts, model.isDefault])).toEqual([
      ["opus", ["low", "high"], true],
      ["sonnet", [], false],
    ])
  })

  test("folds older OpenCode's per-level models into their base model", () => {
    const parsed = AcpHarness.sessionModels({
      models: {
        currentModelId: "opencode/gpt/high",
        availableModels: [
          { modelId: "opencode/gpt", name: "OpenCode/GPT" },
          { modelId: "opencode/gpt/low", name: "OpenCode/GPT (low)" },
          { modelId: "opencode/gpt/high", name: "OpenCode/GPT (high)" },
          { modelId: "opencode/pickle", name: "OpenCode/Pickle" },
          { modelId: "opencode/pickle/mini", name: "OpenCode/Pickle Mini" },
        ],
      },
    })
    expect(parsed.models.map((model) => [model.id, model.reasoningEfforts, model.isDefault])).toEqual([
      ["opencode/gpt", ["low", "high"], true],
      ["opencode/pickle", [], false],
      ["opencode/pickle/mini", [], false],
    ])
    expect([...(parsed.variants ?? [])]).toEqual(["opencode/gpt/low", "opencode/gpt/high"])
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
      "custom-agent": entry({ driver: "acp", name: "Custom Agent", config: { command: "custom-agent" } }),
    })
    expect(instances.map((instance) => `${instance.id}:${instance.driver}`)).toEqual([
      "opencode:opencode",
      "codex:codex",
      "opencode-acp:acp",
      "claude-code:acp",
      "custom-agent:acp",
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
          "claude-code": entry({ driver: "acp", name: "Hijack", config: { command: "/tmp/evil" } }),
          "custom-agent": entry({ driver: "acp", name: "Custom Agent", config: { command: "custom-agent" } }),
        },
      },
    } as unknown as Config.Entry
    const instances = configuredInstances([document], {})
    expect(instances.map((instance) => `${instance.id}:${instance.driver}`)).toEqual([
      "opencode:opencode",
      "codex:codex",
      "opencode-acp:acp",
      "claude-code:acp",
      "custom-agent:acp",
    ])
    expect(instances.find((instance) => instance.id === "opencode-acp")?.config).toEqual({
      command: "opencode",
      args: ["acp"],
    })
    expect(instances.find((instance) => instance.id === "claude-code")?.config).toEqual({
      command: "claude-agent-acp",
      args: [],
    })
  })

  test("a returning ACP session gets only the messages since its last turn", () => {
    const custom = Harness.InstanceID.make("custom-agent")
    const text = (id: string, role: "user" | "assistant", value: string) => ({
      id,
      role,
      content: [{ type: "text" as const, text: value }],
    })
    // Custom Agent answered u1, then Codex took u2 and u3, then the user switched back to Custom Agent.
    const metadata = {
      harnessContinuations: {
        "custom-agent": { nativeID: "acp-session", lastSeenMessageID: "u1" },
        codex: { nativeID: "thread", lastSeenMessageID: "u3" },
      },
    }
    const continuation = continuationFor(metadata, custom, 4)!
    const prompt = renderCodexPrompt(
      LLM.request({
        model: Model.make({ id: "custom-test", provider: "test", route }),
        messages: [
          text("u1", "user", "Custom Agent task"),
          text("a1", "assistant", "Custom Agent reply"),
          text("u2", "user", "Codex task"),
          text("a2", "assistant", "Codex reply"),
          text("u3", "user", "Codex follow-up"),
          text("a3", "assistant", "Codex follow-up reply"),
          text("u4", "user", "Back to Custom Agent"),
        ],
      }),
      continuation.handoff,
    )

    expect(continuation.nativeID).toBe("acp-session")
    expect(prompt).toContain("since you last participated")
    expect(prompt).toContain("USER:\nCodex task")
    expect(prompt).toContain("ASSISTANT:\nCodex follow-up reply")
    expect(prompt).not.toContain("Custom Agent task")
    expect(prompt).not.toContain("Custom Agent reply")
    expect(prompt.endsWith("New user message (respond to this):\nBack to Custom Agent")).toBe(true)
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
