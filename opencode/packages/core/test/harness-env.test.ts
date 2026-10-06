import { describe, expect, test } from "bun:test"
import { harnessEnvironment } from "../src/harness/env"

describe("harnessEnvironment", () => {
  test("passes only the launch allowlist from the app environment", () => {
    const env = harnessEnvironment(
      {},
      {
        PATH: "/usr/bin:/bin",
        HOME: "/home/me",
        TMPDIR: "/tmp",
        TERM: "xterm-256color",
        XDG_CONFIG_HOME: "/home/me/.config",
        SECRET_TOKEN: "s3cret",
        OPENCODE_PROVIDER_KEY: "key",
      },
    )
    expect(env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/home/me",
      TMPDIR: "/tmp",
      TERM: "xterm-256color",
      XDG_CONFIG_HOME: "/home/me/.config",
    })
  })

  test("merges user-configured env and drops empty values", () => {
    const env = harnessEnvironment({ ACME_KEY: "configured", LANG: "" }, { PATH: "/usr/bin", LANG: "en_US.UTF-8" })
    expect(env).toEqual({ PATH: "/usr/bin", LANG: "en_US.UTF-8", ACME_KEY: "configured" })
  })
})