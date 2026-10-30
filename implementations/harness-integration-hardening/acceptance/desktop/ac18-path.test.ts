import { describe, expect, test } from "bun:test"
import { fallbackPath } from "../../../../opencode/packages/desktop/src/main/shell-env"

describe("AC-18 harness CLIs stay findable when the shell probe fails", () => {
  test("common install folders are appended to the bare GUI PATH", () => {
    expect(fallbackPath("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/me").split(":")).toEqual([
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/Users/me/.local/bin",
      "/Users/me/.bun/bin",
      "/Users/me/.opencode/bin",
    ])
  })
})
