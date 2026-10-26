import { describe, expect, test } from "bun:test"
import { Harness } from "@opencode-ai/schema/harness"
import { HarnessRegistry } from "@opencode-ai/core/harness/registry"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

describe("HarnessRegistry title agent", () => {
  test("saves, reads and clears the harness that titles threads", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-registry-"))
    try {
      expect(await Effect.runPromise(HarnessRegistry.titleAgent(dir))).toBeUndefined()

      await Effect.runPromise(HarnessRegistry.setTitleAgent(dir, Harness.Codex))
      expect(await Effect.runPromise(HarnessRegistry.titleAgent(dir))).toBe(Harness.Codex)
      // The preference lives apart from harnesses.json, so the registry list is unaffected.
      expect(await Effect.runPromise(HarnessRegistry.read(dir))).toEqual({})

      await Effect.runPromise(HarnessRegistry.setTitleAgent(dir, undefined))
      expect(await Effect.runPromise(HarnessRegistry.titleAgent(dir))).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
