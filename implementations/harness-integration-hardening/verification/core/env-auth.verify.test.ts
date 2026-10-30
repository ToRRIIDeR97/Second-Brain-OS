import { describe, expect, test } from "bun:test"
import { Exit } from "effect"
import { harnessEnvironment } from "../../../../opencode/packages/core/src/harness/env"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"
import { ProtocolError } from "../../../../opencode/packages/core/src/harness/codex-app-server"

describe("verify AC-16", () => {
  test("lowercase proxy variables pass, and no proxy means NO_PROXY is not invented", () => {
    const env = harnessEnvironment({}, { https_proxy: "http://p:1", PATH: "/bin" })
    expect(env.https_proxy).toBe("http://p:1")
    expect(env.no_proxy?.split(",")).toContain("127.0.0.1")
    const plain = harnessEnvironment({}, { PATH: "/bin" })
    expect(plain.NO_PROXY).toBeUndefined()
    expect(plain.no_proxy).toBeUndefined()
  })

  test("a per-harness configured value still overrides the shell", () => {
    const env = harnessEnvironment({ CLAUDE_CONFIG_DIR: "/custom" }, { CLAUDE_CONFIG_DIR: "/from-shell" })
    expect(env.CLAUDE_CONFIG_DIR).toBe("/custom")
  })
})

describe("verify AC-17", () => {
  test("a not-logged-in message without the code also points to sign-in; other errors keep their text", () => {
    const signedOut = AcpHarness.finishAcpTurn(
      Exit.fail(new ProtocolError("Not logged in · Please run /login")),
      AcpHarness.acpState(),
    ).find((event) => event.type === "provider-error") as { message: string }
    expect(signedOut.message).toMatch(/sign in/i)
    const other = AcpHarness.finishAcpTurn(
      Exit.fail(new ProtocolError("Model not available")),
      AcpHarness.acpState(),
    ).find((event) => event.type === "provider-error") as { message: string }
    expect(other.message).toBe("Model not available")
  })
})
