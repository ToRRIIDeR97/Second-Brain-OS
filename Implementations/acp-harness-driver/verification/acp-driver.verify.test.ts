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
const instance = { id: Harness.InstanceID.make("verify"), driver: Harness.DriverKind.make("acp"), name: "Verify" }

async function workspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-verify-"))
  return { dir, log: path.join(dir, "log.jsonl") }
}
const messages = async (log: string) =>
  (await fs.readFile(log, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
const settings = (scenario: string, env: Record<string, string> = {}) =>
  AcpHarness.decodeSettings({
    command: process.execPath,
    args: [fixture],
    env: { FAKE_ACP_SCENARIO: scenario, ...env },
  })!
const text = (events: ReadonlyArray<{ type: string }>) =>
  events.flatMap((event) => (event.type === "text-delta" ? [(event as { text: string }).text] : [])).join("")

function turn(
  scenario: string,
  input: { text: string; model?: string },
  options: { env?: Record<string, string>; continuation?: string; approve?: boolean; dir?: string } = {},
) {
  return run(
    Effect.gen(function* () {
      const proc = yield* AppProcess.Service
      const session = yield* AcpHarness.open(proc, {
        settings: settings(scenario, options.env),
        directory: options.dir ?? os.tmpdir(),
        continuation: options.continuation,
        approve: () => Effect.succeed(options.approve ?? true),
      })
      return { session, events: Array.from(yield* Stream.runCollect(session.turn(input))) }
    }),
  )
}

describe("ACP harness driver verification", () => {
  test("AC-1 non-JSON output, early exit, and a silent agent are unavailable", async () => {
    const results = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* Effect.all(
          ["not-acp", "exit", "silent"].map((scenario) =>
            AcpHarness.probe(proc, instance, settings(scenario), os.tmpdir()),
          ),
          { concurrency: "unbounded" },
        )
      }),
    )
    for (const result of results) {
      expect(result.status).toBe("unavailable")
      expect(result.error?.length).toBeGreaterThan(0)
    }
  }, 20_000)

  test("AC-2 keeps every update that arrives in the same chunk as the prompt response", async () => {
    const { events } = await turn("burst", { text: "go" })
    expect(text(events)).toBe(Array.from({ length: 200 }, (_, index) => `${index},`).join(""))
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
  })

  test("AC-2 a JSON-RPC prompt error ends with a provider error and an error finish", async () => {
    const { events } = await turn("prompt-error", { text: "go" })
    const error = events.find((event) => event.type === "provider-error")
    expect(JSON.stringify(error)).toContain("boom")
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "error" })
  })

  test("AC-2 maps every ACP stop reason", async () => {
    const expected: Record<string, string> = {
      max_tokens: "length",
      max_turn_requests: "length",
      refusal: "content-filter",
      cancelled: "stop",
    }
    for (const [stop, reason] of Object.entries(expected)) {
      const { events } = await turn("basic", { text: "go" }, { env: { FAKE_ACP_STOP: stop } })
      expect(events.at(-1)).toMatchObject({ type: "finish", reason })
    }
  })

  test("AC-3 falls back to any allow or reject option and cancels when no reject exists", async () => {
    const allowed = await turn("permission-allow-always-only", { text: "go" }, { approve: true })
    expect(JSON.parse(text(allowed.events).replace("outcome:", ""))).toEqual({ outcome: "selected", optionId: "aa" })
    const rejected = await turn("permission-allow-always-only", { text: "go" }, { approve: false })
    expect(JSON.parse(text(rejected.events).replace("outcome:", ""))).toEqual({ outcome: "selected", optionId: "rr" })
    const cancelled = await turn("permission-no-reject", { text: "go" }, { approve: false })
    expect(JSON.parse(text(cancelled.events).replace("outcome:", ""))).toEqual({ outcome: "cancelled" })
  })

  test("AC-3 maps fetch tools to webfetch", async () => {
    const asked: AcpHarness.PermissionRequest[] = []
    await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const session = yield* AcpHarness.open(proc, {
          settings: settings("permission-allow-always-only"),
          directory: os.tmpdir(),
          approve: (request) => Effect.sync(() => asked.push(request)).pipe(Effect.as(true)),
        })
        yield* Stream.runDrain(session.turn({ text: "go" }))
      }),
    )
    expect(asked[0]?.action).toBe("webfetch")
  })

  test("AC-3 rejects file-system and terminal requests with method-not-found", async () => {
    const { events } = await turn("fs-probe", { text: "go" })
    expect(text(events)).toBe("fs:-32601;terminal:-32601")
  })

  test("AC-4 loads a stored session and does not emit replayed history", async () => {
    const { dir, log } = await workspace()
    const { session, events } = await turn(
      "load",
      { text: "next" },
      { continuation: "prev", env: { FAKE_ACP_LOG: log }, dir },
    )
    expect(session.resumed).toBe(true)
    expect(session.sessionId).toBe("prev")
    expect(text(events)).toBe("fresh")
    const sent = await messages(log)
    expect(sent.find((message) => message.method === "session/load")?.params).toMatchObject({
      sessionId: "prev",
      cwd: dir,
    })
    expect(sent.some((message) => message.method === "session/new")).toBe(false)
  })

  test("AC-4 falls back to a new session when load fails or is unsupported", async () => {
    const failed = await workspace()
    const fallback = await turn(
      "load-fails",
      { text: "go" },
      { continuation: "gone", env: { FAKE_ACP_LOG: failed.log } },
    )
    expect(fallback.session.resumed).toBe(false)
    expect((await messages(failed.log)).some((message) => message.method === "session/new")).toBe(true)

    const unsupported = await workspace()
    const plain = await turn("basic", { text: "go" }, { continuation: "old", env: { FAKE_ACP_LOG: unsupported.log } })
    expect(plain.session.resumed).toBe(false)
    expect((await messages(unsupported.log)).some((message) => message.method === "session/load")).toBe(false)
  })

  test("AC-4 sets a different model, skips the current one, and tolerates set_model failure", async () => {
    const changed = await workspace()
    await turn("basic", { text: "go", model: "fake-b" }, { env: { FAKE_ACP_LOG: changed.log } })
    const setModel = (await messages(changed.log)).filter((message) => message.method === "session/set_model")
    expect(setModel.map((message) => message.params)).toEqual([{ sessionId: "s1", modelId: "fake-b" }])

    const same = await workspace()
    await turn("basic", { text: "go", model: "fake-a" }, { env: { FAKE_ACP_LOG: same.log } })
    expect((await messages(same.log)).some((message) => message.method === "session/set_model")).toBe(false)

    const failing = await turn("set-model-fails", { text: "go", model: "fake-b" })
    expect(failing.events.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
  })

  test("AC-5 interrupting a turn sends session/cancel", async () => {
    const { log } = await workspace()
    await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const session = yield* AcpHarness.open(proc, {
          settings: settings("slow", { FAKE_ACP_LOG: log }),
          directory: os.tmpdir(),
          approve: () => Effect.succeed(true),
        })
        yield* session.turn({ text: "long" }).pipe(
          Stream.filter((event) => event.type === "text-delta"),
          Stream.runHead,
        )
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 300)))
      }),
    )
    const cancel = (await messages(log)).find((message) => message.method === "session/cancel")
    expect(cancel?.params).toEqual({ sessionId: "s1" })
  })
})
