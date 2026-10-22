import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { SkillToggle } from "@opencode-ai/core/skill/toggle"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-toggle-"))
afterAll(() => fs.rm(root, { recursive: true, force: true }))

const dir = async (name: string) => {
  const value = path.join(root, name)
  await fs.mkdir(value, { recursive: true })
  return value
}

describe("SkillToggle", () => {
  test("nothing is switched off without a file", async () => {
    expect([...(await Effect.runPromise(SkillToggle.disabled(await dir("empty"))))]).toEqual([])
  })

  test("switching off and on again is saved, sorted and private", async () => {
    const config = await dir("toggle")
    await Effect.runPromise(SkillToggle.set(config, "zeta", false))
    await Effect.runPromise(SkillToggle.set(config, "alpha", false))
    expect([...(await Effect.runPromise(SkillToggle.disabled(config)))]).toEqual(["alpha", "zeta"])
    const file = path.join(config, SkillToggle.fileName)
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ disabled: ["alpha", "zeta"] })
    if (process.platform !== "win32") expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    await Effect.runPromise(SkillToggle.set(config, "zeta", true))
    expect([...(await Effect.runPromise(SkillToggle.disabled(config)))]).toEqual(["alpha"])
  })

  test("concurrent switches all land", async () => {
    const config = await dir("concurrent")
    const names = ["a", "b", "c", "d", "e"]
    await Effect.runPromise(
      Effect.all(
        names.map((name) => SkillToggle.set(config, name, false)),
        { concurrency: "unbounded" },
      ),
    )
    expect([...(await Effect.runPromise(SkillToggle.disabled(config)))]).toEqual(names)
  })

  test("a malformed file switches nothing off and is never overwritten", async () => {
    const config = await dir("broken")
    const file = path.join(config, SkillToggle.fileName)
    await fs.writeFile(file, "{ not json")
    expect([...(await Effect.runPromise(SkillToggle.disabled(config)))]).toEqual([])
    const exit = await Effect.runPromiseExit(SkillToggle.set(config, "notes", false))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(await fs.readFile(file, "utf8")).toBe("{ not json")
  })
})

describe("SkillV2 with switched-off skills", () => {
  test("list() leaves out switched-off skills and all() keeps them", async () => {
    const config = await dir("skill-config")
    const skills = await dir("skill-files")
    for (const name of ["notes", "review"]) {
      await fs.mkdir(path.join(skills, name), { recursive: true })
      await fs.writeFile(path.join(skills, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\nBody`)
    }
    const previous = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = config
    try {
      await Effect.runPromise(SkillToggle.set(config, "review", false))
      const discovery = Layer.succeed(
        SkillDiscovery.Service,
        SkillDiscovery.Service.of({ pull: () => Effect.succeed([]) }),
      )
      const layer = AppNodeBuilder.build(LayerNode.group([SkillV2.node]), [[SkillDiscovery.node, discovery]])
      const names = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SkillV2.Service
          yield* service.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(skills) }))
          return {
            list: (yield* service.list()).map((skill) => skill.name),
            all: (yield* service.all()).map((skill) => skill.name),
          }
        }).pipe(Effect.provide(layer), Effect.scoped) as Effect.Effect<{ list: string[]; all: string[] }>,
      )
      expect(names).toEqual({ list: ["notes"], all: ["notes", "review"] })
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = previous
    }
  })
})
