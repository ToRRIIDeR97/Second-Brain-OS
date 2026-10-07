// Independent verification tests for the harness settings page (core level).
// Same contract as implementation.md, different boundary cases from acceptance/.
// Run from opencode/packages/core: bun test ../../../Implementations/harness-settings-page/verification/registry-settings.verify.test.ts
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Scope, Stream } from "effect"
import { LayerNode } from "../../../opencode/packages/core/src/effect/layer-node"
import { AppProcess } from "../../../opencode/packages/core/src/process"
import { HarnessRegistry } from "../../../opencode/packages/core/src/harness/registry"
import { AcpHarness } from "../../../opencode/packages/core/src/harness/acp"
import { HarnessRuntime } from "../../../opencode/packages/core/src/harness"

const fixture = path.resolve(import.meta.dir, "../fixtures/fake-acp-agent.ts")
const layer = LayerNode.compile(AppProcess.node)
const run = <A, E>(effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<A, E, never>)
const runExit = <A, E>(effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<Exit.Exit<A, E>, never, never>,
  )
const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (exit.cause.reasons.find((reason) => reason._tag === "Fail") as any)?.error : undefined

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "harness-settings-ver-"))
const file = (dir: string) => path.join(dir, HarnessRegistry.fileName)

const register = (configDir: string, id: string, scenario = "models") =>
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    return yield* HarnessRegistry.register(
      {
        id,
        command: process.execPath,
        args: [fixture, scenario],
        models: ["pinned"],
      },
      {
        configDir,
        directory: configDir,
        existing: new Set(["opencode", "codex"]),
        process: proc,
      },
    )
  })

const discover = (command: string, args: string[], directory: string) =>
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    return yield* HarnessRegistry.discover({ command, args }, { directory, process: proc })
  })

describe("Harness settings verification (core)", () => {
  test("AC-3/AC-4 a malformed registry file is reported and left untouched", async () => {
    const configDir = await tempDir()
    await fs.writeFile(file(configDir), "{ not json")
    expect(failure(await runExit(HarnessRegistry.setEnabled(configDir, "any", false)))?.reason).toBe("write-failed")
    expect(failure(await runExit(HarnessRegistry.remove(configDir, "any")))?.reason).toBe("write-failed")
    expect(await fs.readFile(file(configDir), "utf8")).toBe("{ not json")
  })

  test("AC-3 disabling keeps the entry's name, command, args, and models", async () => {
    const configDir = await tempDir()
    await run(register(configDir, "keep"))
    const before = JSON.parse(await fs.readFile(file(configDir), "utf8")).keep
    await run(HarnessRegistry.setEnabled(configDir, "keep", false))
    const after = JSON.parse(await fs.readFile(file(configDir), "utf8")).keep
    expect(after.enabled).toBe(false)
    expect(after.config).toEqual(before.config)
    expect(after.name).toBe(before.name)
    expect(after.driver).toBe("acp")
  })

  test("AC-2/AC-3 a disabled entry still reserves its ID until removed", async () => {
    const configDir = await tempDir()
    await run(register(configDir, "dup"))
    await run(HarnessRegistry.setEnabled(configDir, "dup", false))
    expect(failure(await runExit(register(configDir, "dup")))?.reason).toBe("exists")
    await run(HarnessRegistry.remove(configDir, "dup"))
    const again = await run(register(configDir, "dup"))
    expect(again.id).toBe("dup")
  })

  test("AC-4 removing the last entry leaves a valid empty registry", async () => {
    const configDir = await tempDir()
    await run(register(configDir, "only"))
    await run(HarnessRegistry.remove(configDir, "only"))
    expect(JSON.parse(await fs.readFile(file(configDir), "utf8"))).toEqual({})
    expect(await run(HarnessRegistry.read(configDir))).toEqual({})
  })

  test("AC-4 removing a built-in ID is rejected as reserved", async () => {
    const configDir = await tempDir()
    expect(failure(await runExit(HarnessRegistry.remove(configDir, "opencode")))?.reason).toBe("reserved")
  })

  test("AC-5 discover fails with command-not-found for a command that does not resolve", async () => {
    const directory = await tempDir()
    const exit = await runExit(discover("definitely-not-an-acp-agent-xyz", [], directory))
    expect(failure(exit)?.reason).toBe("command-not-found")
  })

  test("AC-5 discover succeeds with an empty model list when the agent reports none", async () => {
    const directory = await tempDir()
    const result = await run(discover(process.execPath, [fixture, "no-models"], directory))
    expect(result.models).toEqual([])
    expect(result.version).toBe("9.9.9")
  })

  test("AC-6 agents that report the legacy models field still switch with set_model", async () => {
    const text = await run(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const settings = AcpHarness.decodeSettings({
          command: process.execPath,
          args: [fixture, "models"],
        })!
        const session = yield* AcpHarness.open(proc, {
          settings,
          directory: os.tmpdir(),
          approve: () => Effect.succeed(true),
        })
        const events = Array.from(yield* Stream.runCollect(session.turn({ text: "hi", model: "fake-b" })))
        return events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")
      }),
    )
    expect(text).toBe("model:fake-b")
  })

  test("AC-6 the configOptions current value is the default model", async () => {
    const models = await run(
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
        return session.models
      }),
    )
    expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(["fake-a"])
  })

  test("AC-7 a config-file entry shadows a registry entry and is not editable", () => {
    const configEntry = {
      type: "document",
      info: {
        harnesses: {
          shared: {
            driver: "acp",
            name: "From config",
            config: { command: "/bin/cfg" },
          },
        },
      },
    } as any
    const entries = HarnessRuntime.settingsEntries([configEntry], {
      shared: {
        driver: "acp",
        name: "From registry",
        config: { command: "/bin/reg" },
      } as any,
      off: {
        driver: "acp",
        enabled: false,
        config: { command: "/bin/off" },
      } as any,
      codex: {
        driver: "acp",
        name: "Hijack",
        config: { command: "/bin/evil" },
      } as any,
    })
    const byID = Object.fromEntries(entries.map((entry) => [entry.id, entry]))
    expect(byID.shared).toMatchObject({
      source: "config",
      editable: false,
      name: "From config",
    })
    expect(byID.off).toMatchObject({
      source: "registry",
      enabled: false,
      name: "off",
    })
    expect(byID.codex).toMatchObject({ source: "built-in", name: "Codex" })
    expect(entries.filter((entry) => entry.id === "shared")).toHaveLength(1)
  })
})
