import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Scope } from "effect"
import { LayerNode } from "../../../opencode/packages/core/src/effect/layer-node"
import { AppProcess } from "../../../opencode/packages/core/src/process"
import { HarnessRuntime } from "../../../opencode/packages/core/src/harness"
import { HarnessRegistry } from "../../../opencode/packages/core/src/harness/registry"

const fixture = path.resolve(import.meta.dir, "../fixtures/fake-acp-agent.ts")
const layer = LayerNode.compile(AppProcess.node)

async function attempt(input: unknown, options: { existing?: string[]; configDir?: string } = {}) {
  const configDir = options.configDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "acp-registry-verify-")))
  let approvals = 0
  const exit = await Effect.runPromise(
    Effect.exit(
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        return yield* HarnessRegistry.register(input, {
          configDir,
          directory: configDir,
          existing: new Set(options.existing ?? ["opencode", "codex"]),
          process: proc,
          approve: () => Effect.sync(() => approvals++).pipe(Effect.as(true)),
        })
      }),
    ).pipe(Effect.scoped, Effect.provide(layer)) as Effect.Effect<Exit.Exit<unknown, HarnessRegistry.RegisterError>>,
  )
  const reason = Exit.isFailure(exit) ? JSON.stringify(exit.cause) : undefined
  return { configDir, exit, reason, approvals, file: path.join(configDir, HarnessRegistry.fileName) }
}
const valid = (id: string, scenario = "basic") => ({ id, command: process.execPath, args: [fixture, scenario] })
const missing = (file: string) =>
  fs.stat(file).then(
    () => false,
    () => true,
  )

describe("Harness registry verification", () => {
  test("AC-7 rejects bad input before asking or running anything", async () => {
    const cases: Array<[unknown, string, string[]?]> = [
      [{ ...valid("x"), id: "Bad Id!" }, "invalid-id"],
      [{ ...valid("x"), id: "-starts-with-dash" }, "invalid-id"],
      [valid("codex"), "reserved"],
      [valid("opencode"), "reserved"],
      [valid("taken"), "exists", ["opencode", "codex", "taken"]],
      [{ id: "nocmd", command: "no-such-binary-for-acp-tests-xyz" }, "command-not-found"],
      [{ id: "nocommand" }, "invalid-input"],
    ]
    for (const [input, reason, existing] of cases) {
      const result = await attempt(input, { existing })
      expect(Exit.isFailure(result.exit)).toBe(true)
      expect(result.reason).toContain(reason)
      expect(result.approvals).toBe(0)
      expect(await missing(result.file)).toBe(true)
    }
  })

  test("AC-7 a probe failure after approval writes nothing", async () => {
    const result = await attempt(valid("notacp", "not-acp"))
    expect(result.approvals).toBe(1)
    expect(result.reason).toContain("probe-failed")
    expect(await missing(result.file)).toBe(true)
  })

  test("AC-7 resolves a bare command name through PATH to an absolute executable", async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "acp-bin-"))
    const script = path.join(bin, "fake-acp-on-path")
    await fs.writeFile(script, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" basic\n`, { mode: 0o755 })
    const previous = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${previous ?? ""}`
    try {
      const result = await attempt({ id: "onpath", command: "fake-acp-on-path" })
      expect(Exit.isSuccess(result.exit)).toBe(true)
      const entries = await Effect.runPromise(HarnessRegistry.read(result.configDir))
      expect(path.isAbsolute(String((entries.onpath?.config as { command: string }).command))).toBe(true)
    } finally {
      process.env.PATH = previous
    }
  })

  test("AC-7 preserves existing entries and writes the file with mode 0600", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-registry-verify-"))
    await fs.writeFile(
      path.join(configDir, HarnessRegistry.fileName),
      JSON.stringify({ keep: { driver: "acp", name: "Keep", config: { command: "/bin/true" } } }),
    )
    const result = await attempt(valid("added"), { configDir })
    expect(Exit.isSuccess(result.exit)).toBe(true)
    const entries = await Effect.runPromise(HarnessRegistry.read(configDir))
    expect(Object.keys(entries).sort()).toEqual(["added", "keep"])
    expect((await fs.stat(result.file)).mode & 0o777).toBe(0o600)
    expect((await fs.readdir(configDir)).filter((name) => name !== HarnessRegistry.fileName)).toEqual([])
  })

  test("AC-6 a malformed registry is empty and reserved registry IDs are ignored", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-registry-verify-"))
    await fs.writeFile(path.join(configDir, HarnessRegistry.fileName), "{ not json")
    expect(await Effect.runPromise(HarnessRegistry.read(configDir))).toEqual({})
    expect(await Effect.runPromise(HarnessRegistry.read(path.join(configDir, "missing")))).toEqual({})

    const instances = HarnessRuntime.configuredInstances([], {
      codex: { driver: "acp", name: "Hijack", config: { command: "/tmp/evil" } },
      opencode: { driver: "acp", name: "Hijack", config: { command: "/tmp/evil" } },
    })
    const byID = new Map(instances.map((item) => [String(item.id), item]))
    expect(byID.get("codex")).toMatchObject({ driver: "codex", name: "Codex" })
    expect(byID.get("opencode")).toMatchObject({ driver: "opencode", name: "OpenCode" })
  })

  test("AC-8 unknown dynamic tools and failed registrations report success false", async () => {
    const unknown = await Effect.runPromise(
      HarnessRuntime.handleCodexToolCall(
        { threadId: "t", turnId: "u", callId: "c", namespace: null, tool: "something_else", arguments: {} },
        () => Effect.succeed("never"),
      ),
    )
    expect(unknown.success).toBe(false)

    const failed = await Effect.runPromise(
      HarnessRuntime.handleCodexToolCall(
        { threadId: "t", turnId: "u", callId: "c", namespace: null, tool: "harness_register", arguments: { id: "x" } },
        () => Effect.fail({ message: "User declined" }),
      ),
    )
    expect(failed.success).toBe(false)
    expect(failed.contentItems[0]?.text).toContain("User declined")
  })
})
