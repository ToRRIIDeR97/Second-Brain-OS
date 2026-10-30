import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { configuredInstances } from "../../../../opencode/packages/core/src/harness"
import { ConfigHarness } from "../../../../opencode/packages/core/src/config/harness"
import type { Config } from "../../../../opencode/packages/core/src/config"
import { HarnessSetup } from "../../../../opencode/packages/core/src/harness/setup"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"
import { Harness } from "../../../../opencode/packages/schema/src/harness"

const entry = Schema.decodeUnknownSync(ConfigHarness.Instance)

describe("verify AC-6", () => {
  test("a .opencode folder inside the repo and a sibling folder named like the global one are ignored", () => {
    const global = "/home/me/.config/tenon-workbench"
    const make = (path: string, id: string) =>
      ({
        type: "document",
        path,
        info: { harnesses: { [id]: entry({ driver: "acp", name: id, config: { command: "x" } }) } },
      }) as unknown as Config.Entry
    const ids = configuredInstances(
      [
        make("/home/me/repo/.opencode/opencode.jsonc", "dotdir"),
        make("/home/me/.config/tenon-workbench-evil/opencode.json", "lookalike"),
        make(`${global}/opencode.jsonc`, "global-ok"),
      ],
      {},
      global,
    ).map((instance) => instance.id)
    expect(ids).toEqual(expect.arrayContaining(["global-ok"]))
    expect(ids).not.toContain("dotdir")
    expect(ids).not.toContain("lookalike")
  })

  test("registry harnesses are unaffected", () => {
    const ids = configuredInstances(
      [],
      { "my-agent": { driver: "acp", name: "My agent", config: { command: "my-agent" } } as never },
      "/g",
    ).map((instance) => instance.id)
    expect(ids).toContain("my-agent")
  })
})

describe("verify AC-7", () => {
  test("a JSONC user config with a commented-out permission still gets ask", () => {
    const env = HarnessSetup.openCodeLaunchEnv('{\n  // "permission": { "edit": "allow" }\n  "model": "x"\n}')
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!).permission.bash).toBe("ask")
  })
})

describe("verify AC-8", () => {
  test("no change for other modes, no modes, or no default to fall back to", () => {
    expect(AcpHarness.safeAcpMode({ currentModeId: "acceptEdits", availableModes: [{ id: "default" }] })).toBeUndefined()
    expect(AcpHarness.safeAcpMode(undefined)).toBeUndefined()
    expect(
      AcpHarness.safeAcpMode({ currentModeId: "bypassPermissions", availableModes: [{ id: "bypassPermissions" }] }),
    ).toBeUndefined()
  })
})

describe("verify AC-9", () => {
  test("OpenCode's stored key gets no Claude-specific flag, and no stored key gives nothing", () => {
    const opencode = HarnessSetup.keyEnvironment(HarnessSetup.recipe(Harness.OpenCodeAcp), {
      option: "openai",
      key: "sk-o",
    })
    expect(opencode).toEqual({ OPENAI_API_KEY: "sk-o" })
    expect(HarnessSetup.keyEnvironment(HarnessSetup.recipe(Harness.ClaudeCode), undefined)).toEqual({})
  })
})
