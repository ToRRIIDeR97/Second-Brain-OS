import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Scope, Stream } from "effect"
import { Harness } from "@opencode-ai/schema/harness"
import { LayerNode } from "../../../opencode/packages/core/src/effect/layer-node"
import { AppProcess } from "../../../opencode/packages/core/src/process"
import { AcpHarness } from "../../../opencode/packages/core/src/harness/acp"

const fixture = path.resolve(import.meta.dir, "../fixtures/fake-acp-agent.ts")
const layer = LayerNode.compile(AppProcess.node)
const run = <A, E>(effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, E, never>)

const settings = (scenario: string, extra: Record<string, unknown> = {}) => {
  const value = AcpHarness.decodeSettings({ command: process.execPath, args: [fixture, scenario], ...extra })
  if (!value) throw new Error("settings did not decode")
  return value
}
const instance = { id: Harness.InstanceID.make("fake"), driver: Harness.DriverKind.make("acp"), name: "Fake" }
const allow = () => Effect.succeed(true)

describe("ACP harness driver acceptance", () => {
  test("AC-1 probe reports an available ACP agent with its version and configured models", async () => {
    const result = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* AcpHarness.probe(proc, instance, settings("basic", { models: ["m1"] }), os.tmpdir())
      }),
    )
    expect(result).toMatchObject({ id: "fake", driver: "acp", name: "Fake", status: "available", version: "9.9.9" })
    expect(result.models.map((model) => model.id)).toEqual(["m1"])
  })

  test("AC-1 probe reports a missing command as unavailable without failing", async () => {
    const result = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const missing = AcpHarness.decodeSettings({ command: "/definitely/not/a/real/acp-agent" })!
        return yield* AcpHarness.probe(proc, instance, missing, os.tmpdir())
      }),
    )
    expect(result.status).toBe("unavailable")
    expect(result.error?.length).toBeGreaterThan(0)
  })

  test("AC-2 streams text, reasoning, provider-executed tools, usage, and a final finish", async () => {
    const events = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const session = yield* AcpHarness.open(proc, {
          settings: settings("basic"),
          directory: os.tmpdir(),
          approve: allow,
        })
        expect(session.resumed).toBe(false)
        expect(session.models.map((model) => model.id)).toEqual(["fake-a", "fake-b"])
        return Array.from(yield* Stream.runCollect(session.turn({ text: "ping" })))
      }),
    )
    const types = events.map((event) => event.type)
    const text = events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")
    const reasoning = events.flatMap((event) => (event.type === "reasoning-delta" ? [event.text] : [])).join("")
    expect(text).toBe("Hello world:ping")
    expect(reasoning).toBe("thinking")

    const calls = events.filter((event) => event.type === "tool-call")
    const results = events.filter((event) => event.type === "tool-result")
    expect(calls).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(calls[0]).toMatchObject({ id: "t1", providerExecuted: true, input: { command: "ls" } })
    expect(results[0]).toMatchObject({ id: "t1", providerExecuted: true })
    expect(JSON.stringify(results[0])).toContain("file.txt")

    expect(types.at(-2)).toBe("step-finish")
    expect(types.at(-1)).toBe("finish")
    expect(events.at(-1)).toMatchObject({
      reason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, reasoningTokens: 1 },
    })
  })

  test("AC-3 approved permission selects allow_once and maps execute to bash", async () => {
    const asked: AcpHarness.PermissionRequest[] = []
    const events = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const session = yield* AcpHarness.open(proc, {
          settings: settings("permission"),
          directory: os.tmpdir(),
          approve: (request) => Effect.sync(() => asked.push(request)).pipe(Effect.as(true)),
        })
        return Array.from(yield* Stream.runCollect(session.turn({ text: "clean" })))
      }),
    )
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ action: "bash" })
    expect(asked[0]!.resources).toContain("rm -rf build")
    const text = events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")
    expect(JSON.parse(text.replace("outcome:", ""))).toEqual({ outcome: "selected", optionId: "a1" })
  })

  test("AC-3 denied permission selects reject_once", async () => {
    const events = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const session = yield* AcpHarness.open(proc, {
          settings: settings("permission"),
          directory: os.tmpdir(),
          approve: () => Effect.succeed(false),
        })
        return Array.from(yield* Stream.runCollect(session.turn({ text: "clean" })))
      }),
    )
    const text = events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")
    expect(JSON.parse(text.replace("outcome:", ""))).toEqual({ outcome: "selected", optionId: "r1" })
  })

  test("AC-3 initialize advertises no fs or terminal capability", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-acc-"))
    const log = path.join(dir, "log.jsonl")
    await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        yield* AcpHarness.probe(proc, instance, settings("basic", { env: { FAKE_ACP_LOG: log } }), dir)
      }),
    )
    const messages = (await fs.readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const init = messages.find((message) => message.method === "initialize")
    expect(init.jsonrpc).toBe("2.0")
    expect(init.params.protocolVersion).toBe(1)
    const caps = init.params.clientCapabilities ?? {}
    expect(caps.terminal === true).toBe(false)
    expect(caps.fs?.readTextFile === true || caps.fs?.writeTextFile === true).toBe(false)
  })

  test("AC-4 a second turn reuses the ACP session and sends only the latest text", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-acc-"))
    const log = path.join(dir, "log.jsonl")
    await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const session = yield* AcpHarness.open(proc, {
          settings: settings("basic", { env: { FAKE_ACP_LOG: log } }),
          directory: dir,
          approve: allow,
        })
        yield* Stream.runDrain(session.turn({ text: "first" }))
        yield* Stream.runDrain(session.turn({ text: "second" }))
      }),
    )
    const messages = (await fs.readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(messages.filter((message) => message.method === "session/new")).toHaveLength(1)
    const newSession = messages.find((message) => message.method === "session/new")
    expect(newSession.params).toMatchObject({ cwd: dir, mcpServers: [] })
    const prompts = messages.filter((message) => message.method === "session/prompt")
    expect(prompts.map((message) => message.params.sessionId)).toEqual(["s1", "s1"])
    expect(prompts.map((message) => message.params.prompt.map((block: any) => block.text).join(""))).toEqual([
      "first",
      "second",
    ])
  })
})
