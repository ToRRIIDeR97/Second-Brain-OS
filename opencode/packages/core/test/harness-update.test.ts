import { describe, expect, test } from "bun:test"
import { Harness } from "@opencode-ai/schema/harness"
import { AcpHarness } from "@opencode-ai/core/harness/acp"
import { HarnessUpdate } from "@opencode-ai/core/harness/update"

describe("harness CLI install source", () => {
  test("reads a global npm package and its prefix", () => {
    expect(HarnessUpdate.sourceFromPath("/usr/local/lib/node_modules/@openai/codex/bin/codex.js")).toEqual({
      method: "npm",
      packageName: "@openai/codex",
      packageDir: "/usr/local/lib/node_modules/@openai/codex",
      prefix: "/usr/local",
    })
    expect(
      HarnessUpdate.sourceFromPath("/home/me/.nvm/versions/node/v24.1.0/lib/node_modules/opencode-ai/bin/opencode"),
    ).toMatchObject({ method: "npm", packageName: "opencode-ai", prefix: "/home/me/.nvm/versions/node/v24.1.0" })
  })

  test("reads Bun globals and Homebrew formulae and casks", () => {
    expect(
      HarnessUpdate.sourceFromPath("/home/me/.bun/install/global/node_modules/@google/gemini-cli/dist/index.js"),
    ).toMatchObject({ method: "bun", packageName: "@google/gemini-cli" })
    expect(HarnessUpdate.sourceFromPath("/opt/homebrew/Cellar/opencode/1.2.3_1/bin/opencode")).toEqual({
      method: "brew",
      name: "opencode",
      cask: false,
      brew: "/opt/homebrew/bin/brew",
      version: "1.2.3",
    })
    expect(HarnessUpdate.sourceFromPath("/opt/homebrew/Caskroom/codex/0.50.0/codex")).toMatchObject({
      method: "brew",
      cask: true,
      version: "0.50.0",
    })
  })

  test("leaves standalone binaries and package-manager internals alone", () => {
    expect(HarnessUpdate.sourceFromPath("/home/me/.opencode/bin/opencode")).toBeUndefined()
    expect(HarnessUpdate.sourceFromPath("/home/me/project/node_modules/.bin/agent")).toBeUndefined()
    expect(HarnessUpdate.sourceFromPath("/home/me/project/node_modules/agent/cli.js")).toBeUndefined()
  })
})

describe("harness version compare", () => {
  test("compares dotted versions numerically", () => {
    expect(HarnessUpdate.newer("0.10.0", "0.9.9")).toBe(true)
    expect(HarnessUpdate.newer("v1.2.0", "1.2.0")).toBe(false)
    expect(HarnessUpdate.newer("1.2.0", "1.10.0")).toBe(false)
    expect(HarnessUpdate.newer("2.0.0-beta.1", "1.9.0")).toBe(true)
  })
})

describe("ACP model list", () => {
  const model = (id: string) =>
    Harness.Model.make({ id, name: id, reasoningEfforts: [], serviceTiers: [], isDefault: false })

  test("uses the agent's models and falls back to saved IDs only when it reports none", () => {
    expect(AcpHarness.withConfigured([model("live")], ["stale"]).map((item) => item.id)).toEqual(["live"])
    expect(AcpHarness.withConfigured([], ["saved", "saved"]).map((item) => item.id)).toEqual(["saved"])
  })
})
