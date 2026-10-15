import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema, Stream } from "effect"
import { LLM, LLMEvent, Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { Harness } from "@opencode-ai/schema/harness"
import { configuredInstances, continuationFor, failEmptyTurn, renderCodexPrompt } from "@opencode-ai/core/harness"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Config } from "@opencode-ai/core/config"
import { ConfigHarness } from "@opencode-ai/core/config/harness"
import { AcpHarness } from "@opencode-ai/core/harness/acp"
import os from "os"
import path from "path"
import { testEffect } from "./lib/effect"

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

const it = testEffect(LayerNode.compile(AppProcess.node))

// A minimal ACP agent: answers initialize, and session/new with the models in argv (or an error when none).
const fakeAgent = String.raw`
const models = JSON.parse(process.argv[1])
let buffer = ""
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\n")) >= 0) {
    const message = JSON.parse(buffer.slice(0, index))
    buffer = buffer.slice(index + 1)
    const reply = (body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...body }) + "\n")
    if (message.method === "initialize") reply({ result: { protocolVersion: 1, agentInfo: { name: "fake", version: "9.9" } } })
    else if (message.method === "session/new" && models.length === 0) reply({ error: { code: -32000, message: "no session" } })
    else if (message.method === "session/new")
      reply({ result: { sessionId: "s1", models: { currentModelId: models[0], availableModels: models.map((modelId) => ({ modelId, name: modelId })) } } })
  }
})
`

const agentSettings = (models: ReadonlyArray<string>, configured: ReadonlyArray<string> = []) => ({
  command: process.execPath,
  args: ["-e", fakeAgent, JSON.stringify(models)],
  env: {},
  models: configured,
})

const acpInstance = { id: Harness.OpenCodeAcp, driver: Harness.AcpDriver, name: "OpenCode" }

describe("ACP model discovery", () => {
  it.live("probe lists the agent's models from session/new", () =>
    Effect.gen(function* () {
      const process = yield* AppProcess.Service
      const result = yield* AcpHarness.probe(
        process,
        acpInstance,
        agentSettings(["opencode/big-pickle", "opencode-go/glm-5.2"], ["custom/model"]),
        os.tmpdir(),
      )
      expect(result.error).toBeUndefined()
      expect(result.status).toBe("available")
      expect(result.version).toBe("9.9")
      expect(result.models.map((model) => `${model.id}:${model.isDefault}`)).toEqual([
        "opencode/big-pickle:true",
        "opencode-go/glm-5.2:false",
        "custom/model:false",
      ])
    }),
  )

  it.live("probe with known models only handshakes", () =>
    Effect.gen(function* () {
      const process = yield* AppProcess.Service
      const known = AcpHarness.configuredModels(["cached/model"])
      const result = yield* AcpHarness.probe(process, acpInstance, agentSettings(["fresh/model"]), os.tmpdir(), known)
      expect(result.models.map((model) => model.id)).toEqual(["cached/model"])
    }),
  )

  it.live("a failed session/new still reports the agent available", () =>
    Effect.gen(function* () {
      const process = yield* AppProcess.Service
      const result = yield* AcpHarness.probe(process, acpInstance, agentSettings([], ["custom/model"]), os.tmpdir())
      expect(result.status).toBe("available")
      expect(result.models.map((model) => model.id)).toEqual(["custom/model"])
    }),
  )
})

describe("empty harness turns", () => {
  const run = (events: ReadonlyArray<LLMEvent>) =>
    Effect.runPromise(Stream.runCollect(failEmptyTurn(Stream.fromIterable(events), "OpenCode"))).then((chunk) =>
      Array.from(chunk),
    )

  test("a turn with no content and no output tokens becomes an error", async () => {
    const events = await run([
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }),
      LLMEvent.finish({ reason: "stop" }),
    ])
    expect(events.map((event) => event.type)).toEqual(["step-start", "provider-error", "step-finish", "finish"])
    expect(events[1]).toMatchObject({ message: "OpenCode returned nothing. Check its model and credentials." })
    expect(events.slice(2)).toMatchObject([{ reason: "error" }, { reason: "error" }])
  })

  test("turns with text, tools or output tokens pass through", async () => {
    const finish = [LLMEvent.stepFinish({ index: 0, reason: "stop" }), LLMEvent.finish({ reason: "stop" })]
    const text = await run([LLMEvent.textStart({ id: "t" }), LLMEvent.textDelta({ id: "t", text: "hi" }), ...finish])
    const tool = await run([
      LLMEvent.toolCall({ id: "c", name: "acp_read", input: {}, providerExecuted: true }),
      ...finish,
    ])
    const tokens = await run([
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { outputTokens: 3 } }),
      LLMEvent.finish({ reason: "stop", usage: { outputTokens: 3 } }),
    ])
    expect([text, tool, tokens].map((events) => events.at(-1))).toMatchObject([
      { reason: "stop" },
      { reason: "stop" },
      { reason: "stop" },
    ])
    expect([...text, ...tool, ...tokens].some((event) => event.type === "provider-error")).toBe(false)
  })
})
