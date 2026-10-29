import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HarnessCatalogCache } from "@opencode-ai/core/harness/catalog-cache"

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "harness-catalog-"))
const model = (id: string) => ({ id, name: id, reasoningEfforts: [], serviceTiers: [], isDefault: false })

describe("harness catalog cache", () => {
  test("stores each instance's models under a hash of its key and reads them back", async () => {
    const dir = await temp()
    const codex = `codex:${JSON.stringify(["Codex", { env: { OPENAI_API_KEY: "sk-secret" } }])}`
    const claude = `claude-code:${JSON.stringify(["Claude Code", {}])}`
    await Effect.runPromise(HarnessCatalogCache.write(dir, codex, { models: [model("gpt-5.5")], checked: 1 }))
    await Effect.runPromise(HarnessCatalogCache.write(dir, claude, { models: [model("sonnet")], checked: 2 }))

    expect(await Effect.runPromise(HarnessCatalogCache.read(dir))).toEqual({
      [HarnessCatalogCache.id(codex)]: { models: [model("gpt-5.5")], checked: 1 },
      [HarnessCatalogCache.id(claude)]: { models: [model("sonnet")], checked: 2 },
    })
    // Instance configs can carry API keys; the file holds only their hashes.
    expect(await fs.readFile(path.join(dir, HarnessCatalogCache.fileName), "utf8")).not.toContain("sk-secret")
  })

  test("ignores a missing or corrupt file", async () => {
    const dir = await temp()
    expect(await Effect.runPromise(HarnessCatalogCache.read(dir))).toEqual({})
    await fs.writeFile(path.join(dir, HarnessCatalogCache.fileName), "{not json")
    expect(await Effect.runPromise(HarnessCatalogCache.read(dir))).toEqual({})
    await fs.writeFile(path.join(dir, HarnessCatalogCache.fileName), JSON.stringify({ key: { models: "x" } }))
    expect(await Effect.runPromise(HarnessCatalogCache.read(dir))).toEqual({})

    // A corrupt file is replaced by the next write.
    await Effect.runPromise(HarnessCatalogCache.write(dir, "codex:[]", { models: [model("gpt-5.5")], checked: 3 }))
    expect(await Effect.runPromise(HarnessCatalogCache.read(dir))).toEqual({
      [HarnessCatalogCache.id("codex:[]")]: { models: [model("gpt-5.5")], checked: 3 },
    })
  })
})
