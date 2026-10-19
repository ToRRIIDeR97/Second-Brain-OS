import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isNushell, loadShellEnv, mergeShellEnv, parseShellEnv, resolveUserShell } from "./shell-env"

const dir = mkdtempSync(join(tmpdir(), "shell-env-test-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fakeShell(name: string, body: string) {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

function logger() {
  const lines: string[] = []
  return { lines, log: (message: string) => lines.push(message) }
}

describe("shell env", () => {
  test("parseShellEnv supports null-delimited pairs", () => {
    const env = parseShellEnv(Buffer.from("PATH=/usr/bin:/bin\0FOO=bar=baz\0\0"))

    expect(env.PATH).toBe("/usr/bin:/bin")
    expect(env.FOO).toBe("bar=baz")
  })

  test("parseShellEnv ignores invalid entries", () => {
    const env = parseShellEnv(Buffer.from("INVALID\0=empty\0OK=1\0"))

    expect(Object.keys(env).length).toBe(1)
    expect(env.OK).toBe("1")
  })

  test("mergeShellEnv keeps explicit overrides", () => {
    const env = mergeShellEnv(
      {
        PATH: "/shell/path",
        HOME: "/tmp/home",
      },
      {
        PATH: "/desktop/path",
        OPENCODE_CLIENT: "desktop",
      },
    )

    expect(env.PATH).toBe("/desktop/path")
    expect(env.HOME).toBe("/tmp/home")
    expect(env.OPENCODE_CLIENT).toBe("desktop")
  })

  test("resolveUserShell falls back to the login shell before /bin/sh", () => {
    expect(resolveUserShell("/custom/env-shell", "/bin/zsh")).toBe("/custom/env-shell")
    expect(resolveUserShell(undefined, "/bin/zsh")).toBe("/bin/zsh")
    expect(resolveUserShell(undefined, "unknown")).toBe("/bin/sh")
    expect(resolveUserShell(undefined, undefined)).toBe("/bin/sh")
  })

  test("isNushell handles path and binary name", () => {
    expect(isNushell("nu")).toBe(true)
    expect(isNushell("/opt/homebrew/bin/nu")).toBe(true)
    expect(isNushell("C:\\Program Files\\nu.exe")).toBe(true)
    expect(isNushell("/bin/zsh")).toBe(false)
  })

  test.skipIf(process.platform === "win32")(
    "loadShellEnv reads the interactive login shell without blocking",
    async () => {
      const log = logger()
      const pending = loadShellEnv(fakeShell("interactive", "printf 'MODE=%s\\0PATH=/x\\0' \"$1\""), log)
      expect(pending).toBeInstanceOf(Promise)
      expect(await pending).toEqual({ MODE: "-il", PATH: "/x" })
    },
  )

  test.skipIf(process.platform === "win32")("loadShellEnv falls back to a login shell", async () => {
    const shell = fakeShell("login", `if [ "$1" = "-il" ]; then exit 1; fi\nprintf 'MODE=%s\\0' "$1"`)
    expect(await loadShellEnv(shell, logger())).toEqual({ MODE: "-l" })
  })

  test.skipIf(process.platform === "win32")("loadShellEnv gives up on a slow shell after the timeout", async () => {
    const log = logger()
    const started = Date.now()
    expect(await loadShellEnv(fakeShell("slow", "sleep 5"), log, 100)).toBeNull()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(log.lines.some((line) => line.includes("timed out"))).toBe(true)
  })
})
