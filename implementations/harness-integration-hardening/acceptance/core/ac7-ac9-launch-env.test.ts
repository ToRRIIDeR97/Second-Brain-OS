import { describe, expect, test } from "bun:test"
import { HarnessSetup } from "../../../../opencode/packages/core/src/harness/setup"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"
import { Harness } from "../../../../opencode/packages/schema/src/harness"

describe("AC-7 OpenCode asks before edits and commands", () => {
  test("no user permission config: edit and bash ask", () => {
    const env = HarnessSetup.openCodeLaunchEnv(undefined)
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!)
    expect(config.permission.edit).toBe("ask")
    expect(config.permission.bash).toBe("ask")
  })

  test("the user's own permission config wins", () => {
    expect(HarnessSetup.openCodeLaunchEnv('{ "permission": { "edit": "allow" } }')).toEqual({})
  })
})

describe("AC-8 an ACP session in bypass mode is moved to default", () => {
  test("bypassPermissions with a default mode available", () => {
    expect(
      AcpHarness.safeAcpMode({
        currentModeId: "bypassPermissions",
        availableModes: [{ id: "default" }, { id: "acceptEdits" }, { id: "bypassPermissions" }],
      }),
    ).toBe("default")
  })
})

describe("AC-9 a stored Anthropic key turns on Claude Code's subprocess scrub", () => {
  test("the key and the scrub flag", () => {
    const env = HarnessSetup.keyEnvironment(HarnessSetup.recipe(Harness.ClaudeCode), {
      option: "anthropic",
      key: "sk-test",
    })
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-test", CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" })
  })
})
