import { describe, expect, test } from "bun:test"
import { fallbackPath } from "../../../../opencode/packages/desktop/src/main/shell-env"

describe("verify AC-18", () => {
  test("folders already on PATH are not repeated and keep their position", () => {
    const result = fallbackPath("/opt/homebrew/bin:/usr/bin", "/h").split(":")
    expect(result.filter((item) => item === "/opt/homebrew/bin")).toHaveLength(1)
    expect(result[0]).toBe("/opt/homebrew/bin")
    expect(result).toContain("/h/.opencode/bin")
  })

  test("an empty PATH still gets the common folders", () => {
    expect(fallbackPath("", "/h").split(":")).toContain("/usr/local/bin")
    expect(fallbackPath("", "/h").split(":")).not.toContain("")
  })
})
