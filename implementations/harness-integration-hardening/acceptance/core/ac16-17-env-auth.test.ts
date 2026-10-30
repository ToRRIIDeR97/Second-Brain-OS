import { describe, expect, test } from "bun:test"
import { Exit } from "effect"
import { harnessEnvironment } from "../../../../opencode/packages/core/src/harness/env"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"
import { ProtocolError } from "../../../../opencode/packages/core/src/harness/codex-app-server"

describe("AC-16 harnesses get the network, config and tooling settings the shell has", () => {
  test("proxy, CA, config-dir, routing and tooling variables pass; keys don't", () => {
    const env = harnessEnvironment(
      {},
      {
        PATH: "/usr/bin",
        HTTPS_PROXY: "http://proxy:3128",
        NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
        CLAUDE_CONFIG_DIR: "/Users/me/.claude-work",
        CODEX_HOME: "/Users/me/.codex-work",
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_PROFILE: "work",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        SHELL: "/bin/zsh",
        ANTHROPIC_API_KEY: "sk-secret",
        GH_TOKEN: "ghp-secret",
        AWS_SECRET_ACCESS_KEY: "secret",
      },
    )
    expect(env).toMatchObject({
      HTTPS_PROXY: "http://proxy:3128",
      NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
      CLAUDE_CONFIG_DIR: "/Users/me/.claude-work",
      CODEX_HOME: "/Users/me/.codex-work",
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_PROFILE: "work",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      SHELL: "/bin/zsh",
    })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test("with a proxy set, loopback is excluded from it", () => {
    const env = harnessEnvironment({}, { HTTPS_PROXY: "http://proxy:3128", NO_PROXY: "corp.internal" })
    for (const host of ["corp.internal", "127.0.0.1", "localhost", "::1"]) {
      expect(env.NO_PROXY?.split(",")).toContain(host)
      expect(env.no_proxy?.split(",")).toContain(host)
    }
  })
})

describe("AC-17 a signed-out ACP agent says so", () => {
  test("an auth-required error points to sign-in", () => {
    const events = AcpHarness.finishAcpTurn(
      Exit.fail(new ProtocolError("Authentication required", { code: -32000 })),
      AcpHarness.acpState(),
    )
    const error = events.find((event) => event.type === "provider-error") as { message: string }
    expect(error.message).toMatch(/sign in/i)
    expect(error.message).toContain("Settings")
  })
})
