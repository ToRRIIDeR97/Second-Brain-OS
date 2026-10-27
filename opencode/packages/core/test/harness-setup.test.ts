import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Harness } from "@opencode-ai/schema/harness"
import { HarnessSetup } from "@opencode-ai/core/harness/setup"

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "harness-setup-"))

describe("harness setup", () => {
  test("covers exactly the built-in external harnesses", () => {
    expect(HarnessSetup.recipes.map((item) => item.id)).toEqual([
      Harness.Codex,
      Harness.ClaudeCode,
      Harness.OpenCodeAcp,
    ])
    expect(HarnessSetup.recipe("gemini")).toBeUndefined()
    expect(HarnessSetup.recipe(Harness.OpenCode)).toBeUndefined()
  })

  test("stores one key per harness in a private file and bumps the revision", async () => {
    const dir = await temp()
    const before = HarnessSetup.keysVersion()
    await Effect.runPromise(HarnessSetup.writeKey(dir, "claude-code", { option: "anthropic", key: "sk-1" }))
    await Effect.runPromise(HarnessSetup.writeKey(dir, "opencode-acp", { option: "openai", key: "sk-2" }))
    expect(await Effect.runPromise(HarnessSetup.readKeys(dir))).toEqual({
      "claude-code": { option: "anthropic", key: "sk-1" },
      "opencode-acp": { option: "openai", key: "sk-2" },
    })
    expect((await fs.stat(path.join(dir, HarnessSetup.fileName))).mode & 0o777).toBe(0o600)
    await Effect.runPromise(HarnessSetup.writeKey(dir, "claude-code", undefined))
    expect(await Effect.runPromise(HarnessSetup.readKeys(dir))).toEqual({
      "opencode-acp": { option: "openai", key: "sk-2" },
    })
    expect(HarnessSetup.keysVersion()).toBe(before + 3)
  })

  test("turns a stored key into the harness's environment variable", () => {
    const opencode = HarnessSetup.recipe(Harness.OpenCodeAcp)
    expect(HarnessSetup.keyEnvironment(opencode, { option: "openrouter", key: "k" })).toEqual({
      OPENROUTER_API_KEY: "k",
    })
    expect(HarnessSetup.keyEnvironment(opencode, { option: "unknown", key: "k" })).toEqual({})
    // Codex keeps its own key through its app-server login, so nothing reaches its environment.
    expect(HarnessSetup.keyEnvironment(HarnessSetup.recipe(Harness.Codex), { option: "openai", key: "k" })).toEqual({})
  })

  test("reads sign-in state from each CLI's own files", async () => {
    const home = await temp()
    const claude = HarnessSetup.recipe(Harness.ClaudeCode)!
    const opencode = HarnessSetup.recipe(Harness.OpenCodeAcp)!
    const env = { HOME: home, XDG_DATA_HOME: path.join(home, "data") }
    expect(await Effect.runPromise(HarnessSetup.signedIn(claude, env))).toBe("signed-out")
    expect(await Effect.runPromise(HarnessSetup.signedIn(opencode, env))).toBe("signed-out")

    await fs.writeFile(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" } }))
    await fs.mkdir(path.join(home, "data", "opencode"), { recursive: true })
    await fs.writeFile(path.join(home, "data", "opencode", "auth.json"), JSON.stringify({ anthropic: { type: "api" } }))
    expect(await Effect.runPromise(HarnessSetup.signedIn(claude, env))).toBe("signed-in")
    expect(await Effect.runPromise(HarnessSetup.signedIn(opencode, env))).toBe("signed-in")
  })
})
