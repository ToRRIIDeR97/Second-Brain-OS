// Worker-visible acceptance tests for the harness settings page (core level).
// Run from opencode/packages/core: bun test ../../../Implementations/harness-settings-page/acceptance
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Scope, Stream } from "effect"
import { LayerNode } from "../../../opencode/packages/core/src/effect/layer-node"
import { AppProcess } from "../../../opencode/packages/core/src/process"
import { HarnessRegistry } from "../../../opencode/packages/core/src/harness/registry"
import { AcpHarness } from "../../../opencode/packages/core/src/harness/acp"
import { HarnessRuntime } from "../../../opencode/packages/core/src/harness"

const fixture = path.resolve(import.meta.dir, "../fixtures/fake-acp-agent.ts")
const coreSrc = path.resolve(import.meta.dir, "../../../opencode/packages/core/src")
const layer = LayerNode.compile(AppProcess.node)
const run = <A, E>(effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, E, never>)
const runExit = <A, E>(effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<Exit.Exit<A, E>, never, never>,
  )
const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (exit.cause.reasons.find((reason) => reason._tag === "Fail") as any)?.error : undefined

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "harness-settings-acc-"))
const readFile = async (dir: string) =>
  JSON.parse(await fs.readFile(path.join(dir, HarnessRegistry.fileName), "utf8")) as Record<string, any>

const register = (configDir: string, input: Record<string, unknown>) =>
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    return yield* HarnessRegistry.register(input, {
      configDir,
      directory: configDir,
      existing: new Set(["opencode", "codex"]),
      process: proc,
    })
  })

const fake = (id: string, scenario = "models") => ({
  id,
  name: `Fake ${id}`,
  command: process.execPath,
  args: [fixture, scenario],
})

describe("Harness settings acceptance (core)", () => {
  test("AC-1 harness_register is no longer an agent tool", async () => {
    expect(existsSync(path.join(coreSrc, "tool/harness-register.ts"))).toBe(false)
    const builtins = await fs.readFile(path.join(coreSrc, "tool/builtins.ts"), "utf8")
    const runtime = await fs.readFile(path.join(coreSrc, "harness.ts"), "utf8")
    const agent = await fs.readFile(path.join(coreSrc, "plugin/agent.ts"), "utf8")
    for (const source of [builtins, runtime, agent]) expect(source).not.toContain("harness_register")
    expect(runtime).not.toContain("dynamicTools")
  })

  test("AC-2 registration from settings writes the entry without an approval callback", async () => {
    const configDir = await tempDir()
    const result = await run(register(configDir, fake("fake")))
    expect(result).toMatchObject({
      id: "fake",
      agentName: "Fake ACP",
      version: "9.9.9",
    })
    const file = await readFile(configDir)
    expect(file.fake).toMatchObject({
      driver: "acp",
      name: "Fake fake",
      config: { command: process.execPath, args: [fixture, "models"] },
    })
  })

  test("AC-3 an entry can be disabled and enabled again", async () => {
    const configDir = await tempDir()
    await run(register(configDir, fake("fake")))
    await run(HarnessRegistry.setEnabled(configDir, "fake", false))
    expect((await run(HarnessRegistry.read(configDir))).fake?.enabled).toBe(false)
    await run(HarnessRegistry.setEnabled(configDir, "fake", true))
    expect((await run(HarnessRegistry.read(configDir))).fake?.enabled).not.toBe(false)
  })

  test("AC-3 toggling a built-in or a missing entry fails with a typed reason", async () => {
    const configDir = await tempDir()
    expect(failure(await runExit(HarnessRegistry.setEnabled(configDir, "codex", false)))?.reason).toBe("reserved")
    expect(failure(await runExit(HarnessRegistry.setEnabled(configDir, "ghost", false)))?.reason).toBe("not-found")
  })

  test("AC-4 removing an entry deletes only that entry", async () => {
    const configDir = await tempDir()
    await run(register(configDir, fake("one")))
    await run(register(configDir, fake("two")))
    await run(HarnessRegistry.remove(configDir, "one"))
    const file = await readFile(configDir)
    expect(Object.keys(file)).toEqual(["two"])
    expect(failure(await runExit(HarnessRegistry.remove(configDir, "one")))?.reason).toBe("not-found")
  })

  test("AC-5 discover reports agent info and models from the legacy models field without writing", async () => {
    const configDir = await tempDir()
    const result = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* HarnessRegistry.discover(
          { command: process.execPath, args: [fixture, "models"] },
          { directory: configDir, process: proc },
        )
      }),
    )
    expect(result).toMatchObject({
      command: process.execPath,
      agentName: "Fake ACP",
      version: "9.9.9",
    })
    expect(result.models.map((model) => model.id)).toEqual(["fake-a", "fake-b"])
    expect(existsSync(path.join(configDir, HarnessRegistry.fileName))).toBe(false)
  })

  test("AC-5 discover reads models from ACP configOptions", async () => {
    const configDir = await tempDir()
    const result = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* HarnessRegistry.discover(
          { command: process.execPath, args: [fixture, "config-options"] },
          { directory: configDir, process: proc },
        )
      }),
    )
    expect(result.models.map((model) => model.id)).toEqual(["fake-a", "fake-b"])
    expect(result.models.find((model) => model.isDefault)?.id).toBe("fake-a")
  })

  test("AC-5 discover rejects a command that does not speak ACP", async () => {
    const configDir = await tempDir()
    const exit = await runExit(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* HarnessRegistry.discover(
          { command: process.execPath, args: [fixture, "not-acp"] },
          { directory: configDir, process: proc },
        )
      }),
    )
    expect(failure(exit)?.reason).toBe("probe-failed")
  })

  test("AC-6 an ACP session built from configOptions lists models and switches with set_config_option", async () => {
    const text = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const settings = AcpHarness.decodeSettings({
          command: process.execPath,
          args: [fixture, "config-options"],
        })!
        const session = yield* AcpHarness.open(proc, {
          settings,
          directory: os.tmpdir(),
          approve: () => Effect.succeed(true),
        })
        expect(session.models.map((model) => model.id)).toEqual(["fake-a", "fake-b"])
        const events = Array.from(yield* Stream.runCollect(session.turn({ text: "hi", model: "fake-b" })))
        return events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")
      }),
    )
    expect(text).toBe("model:fake-b")
  })

  test("AC-7 settings entries label built-in, registry, and config sources", () => {
    const entries = HarnessRuntime.settingsEntries([], {
      mine: {
        driver: "acp",
        name: "Mine",
        config: { command: "/bin/mine", args: ["acp"] },
      } as any,
    })
    const byID = Object.fromEntries(entries.map((entry) => [entry.id, entry]))
    expect(byID.opencode).toMatchObject({
      source: "built-in",
      editable: false,
      enabled: true,
    })
    expect(byID.codex).toMatchObject({ source: "built-in", editable: false })
    expect(byID.mine).toMatchObject({
      source: "registry",
      editable: true,
      enabled: true,
      name: "Mine",
      command: "/bin/mine",
      args: ["acp"],
    })
  })
})
