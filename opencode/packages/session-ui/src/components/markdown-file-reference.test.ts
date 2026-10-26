import { describe, expect, test } from "bun:test"
import { fileReferenceRangeLabel, parseFileReference, resolveFileReferencePath } from "./markdown-file-reference"

describe("parseFileReference", () => {
  test("reads a path with an optional line or range", () => {
    expect(parseFileReference("README.md")).toEqual({ path: "README.md" })
    expect(parseFileReference("harness.ts:489")).toEqual({ path: "harness.ts", start: 489, end: 489 })
    expect(parseFileReference("core/src/harness.ts:1552-1556")).toEqual({
      path: "core/src/harness.ts",
      start: 1552,
      end: 1556,
    })
    expect(parseFileReference("src/app.tsx#L10")).toEqual({ path: "src/app.tsx", start: 10, end: 10 })
    expect(parseFileReference("src/app.tsx#L10-L20")).toEqual({ path: "src/app.tsx", start: 10, end: 20 })
    expect(parseFileReference("src/app.tsx:12:4")).toEqual({ path: "src/app.tsx", start: 12, end: 12 })
    expect(parseFileReference("Dockerfile:3")).toEqual({ path: "Dockerfile", start: 3, end: 3 })
  })

  test("keeps a reversed or zero range from becoming a range", () => {
    expect(parseFileReference("a.ts:20-10")).toEqual({ path: "a.ts", start: 20, end: 20 })
    expect(parseFileReference("a.ts:0")).toEqual({ path: "a.ts" })
  })

  test("ignores code, directories and URLs", () => {
    expect(parseFileReference("sync.data.session")).toBeUndefined()
    expect(parseFileReference("packages/desktop-electron")).toBeUndefined()
    expect(parseFileReference("src/")).toBeUndefined()
    expect(parseFileReference("https://opencode.ai/docs.html")).toBeUndefined()
    expect(parseFileReference("a.ts:12-x")).toBeUndefined()
    expect(parseFileReference("foo(bar.ts)")).toBeUndefined()
    expect(parseFileReference("1.2")).toBeUndefined()
  })
})

describe("resolveFileReferencePath", () => {
  test("normalizes paths relative to the thread directory", () => {
    expect(resolveFileReferencePath("core/src/harness.ts", "/repo")).toBe("core/src/harness.ts")
    expect(resolveFileReferencePath("./core//src/./harness.ts", "/repo")).toBe("core/src/harness.ts")
  })

  test("turns an absolute path inside the directory into a relative one", () => {
    expect(resolveFileReferencePath("/repo/core/a.ts", "/repo")).toBe("core/a.ts")
    expect(resolveFileReferencePath("/repo/core/a.ts", "/repo/")).toBe("core/a.ts")
    expect(resolveFileReferencePath("C:\\Repo\\core\\a.ts", "c:\\repo")).toBe("core/a.ts")
  })

  test("rejects paths that leave the directory", () => {
    expect(resolveFileReferencePath("../secret.txt", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("core/../../secret.txt", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("/repo-other/a.ts", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("/etc/passwd", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("/repo", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("~/.bashrc", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("..\\secret.txt", "C:\\repo")).toBeUndefined()
    expect(resolveFileReferencePath("D:\\repo\\a.ts", "C:\\repo")).toBeUndefined()
    expect(resolveFileReferencePath("a.ts", "")).toBeUndefined()
  })
})

describe("fileReferenceRangeLabel", () => {
  test("formats single lines and ranges", () => {
    expect(fileReferenceRangeLabel({})).toBe("")
    expect(fileReferenceRangeLabel({ start: 27, end: 27 })).toBe("L27")
    expect(fileReferenceRangeLabel({ start: 27, end: 29 })).toBe("L27\u201329")
  })
})
