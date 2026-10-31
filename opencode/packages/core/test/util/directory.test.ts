import { describe, expect, test } from "bun:test"
import { canonicalDirectory } from "../../src/util/directory"

describe("canonicalDirectory", () => {
  test("gives Windows spellings of one folder the same key", () => {
    const forms = [
      "C:/Users/sense/Brain",
      "C:\\Users\\sense\\Brain",
      "c:\\Users\\sense\\Brain\\",
      "C:\\Users\\sense\\.\\Brain",
    ]
    expect(new Set(forms.map((form) => canonicalDirectory(form, "win32")))).toEqual(
      new Set(["C:\\Users\\sense\\Brain"]),
    )
  })

  test("keeps the drive root", () => {
    expect(canonicalDirectory("d:/", "win32")).toBe("D:\\")
  })

  test("normalises POSIX paths", () => {
    expect(canonicalDirectory("/repo/src/../", "darwin")).toBe("/repo")
  })
})
