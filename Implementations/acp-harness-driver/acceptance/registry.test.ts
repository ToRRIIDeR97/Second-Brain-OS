import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Schema, Scope } from "effect"
import { LayerNode } from "../../../opencode/packages/core/src/effect/layer-node"
import { AppProcess } from "../../../opencode/packages/core/src/process"
import { Config } from "../../../opencode/packages/core/src/config"
import { HarnessRuntime } from "../../../opencode/packages/core/src/harness"
import { HarnessRegistry } from "../../../opencode/packages/core/src/harness/registry"

const fixture = path.resolve(import.meta.dir, "../fixtures/fake-acp-agent.ts")
const layer = LayerNode.compile(AppProcess.node)
const run = <A, E>(effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, E, never>)
const runExit = <A, E>(effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<Exit.Exit<A, E>, never, never>,
  )

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "acp-registry-acc-"))
const input = { id: "fake", name: "Fake Agent", command: process.execPath, args: [fixture, "basic"], models: ["m1"] }

describe("Harness registry acceptance", () => {
  test("AC-7 approved registration probes the agent and writes the registry entry", async () => {
    const configDir = await tempDir()
    const approvals: HarnessRegistry.Approval[] = []
    const result = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* HarnessRegistry.register(input, {
          configDir,
          directory: configDir,
          existing: new Set(["opencode", "codex"]),
          process: proc,
          approve: (approval) => Effect.sync(() => approvals.push(approval)).pipe(Effect.as(true)),
        })
      }),
    )
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ id: "fake", name: "Fake Agent", command: process.execPath })
    expect(approvals[0]!.args).toEqual([fixture, "basic"])
    expect(result).toMatchObject({ id: "fake", name: "Fake Agent", version: "9.9.9" })

    const entries = await Effect.runPromise(HarnessRegistry.read(configDir))
    expect(entries.fake).toMatchObject({
      driver: "acp",
      name: "Fake Agent",
      config: { command: process.execPath, args: [fixture, "basic"], models: ["m1"] },
    })
    expect(JSON.parse(await fs.readFile(path.join(configDir, HarnessRegistry.fileName), "utf8")).fake).toBeDefined()
  })

  test("AC-7 a denied registration writes nothing", async () => {
    const configDir = await tempDir()
    const exit = await runExit(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* HarnessRegistry.register(input, {
          configDir,
          directory: configDir,
          existing: new Set(["opencode", "codex"]),
          process: proc,
          approve: () => Effect.succeed(false),
        })
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain("denied")
    await expect(fs.stat(path.join(configDir, HarnessRegistry.fileName))).rejects.toThrow()
  })

  test("AC-6 registry entries merge with built-ins and config entries win on the same ID", () => {
    const entries = [
      Schema.decodeUnknownSync(Config.Document)({
        type: "document",
        info: { harnesses: { fake: { driver: "acp", name: "From config", config: { command: "a" } } } },
      }),
    ]
    const instances = HarnessRuntime.configuredInstances(entries, {
      fake: { driver: "acp", name: "From registry", config: { command: "b" } },
      other: { driver: "acp", name: "Other", config: { command: "c" } },
    })
    const byID = new Map(instances.map((item) => [String(item.id), item]))
    expect(byID.get("fake")?.name).toBe("From config")
    expect(byID.get("other")?.name).toBe("Other")
    expect(byID.has("opencode")).toBe(true)
    expect(byID.has("codex")).toBe(true)
  })

  test("AC-8 Codex receives harness_register and a tool call runs the registration", async () => {
    const spec = HarnessRuntime.codexDynamicTools.find((tool) => tool.name === "harness_register")
    expect(spec).toMatchObject({ type: "function" })
    expect(JSON.stringify(spec?.inputSchema)).toContain("command")

    const received: unknown[] = []
    const response = await Effect.runPromise(
      HarnessRuntime.handleCodexToolCall(
        {
          threadId: "th",
          turnId: "tu",
          callId: "c1",
          namespace: null,
          tool: "harness_register",
          arguments: { id: "x" },
        },
        (args) => Effect.sync(() => received.push(args)).pipe(Effect.as("Registered x")),
      ),
    )
    expect(received).toEqual([{ id: "x" }])
    expect(response).toEqual({ success: true, contentItems: [{ type: "inputText", text: "Registered x" }] })
  })
})
