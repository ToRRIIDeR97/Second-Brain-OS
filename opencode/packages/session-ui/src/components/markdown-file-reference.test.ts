import { describe, expect, test } from "bun:test"
import {
  fileCitations,
  localLinkTarget,
  listedEntryPath,
  fileReferenceRangeLabel,
  parseFileReference,
  resolveFileReferencePath,
  settleFileReference,
} from "./markdown-file-reference"

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

  test("reads a trailing slash as a folder and leaves an extensionless path to the listing", () => {
    expect(parseFileReference("notes/")).toEqual({ path: "notes/", kind: "folder" })
    expect(parseFileReference("src\\components\\")).toEqual({ path: "src\\components\\", kind: "folder" })
    expect(parseFileReference("src/components")).toEqual({ path: "src/components", kind: "either" })
    expect(parseFileReference("packages/desktop-electron")).toEqual({
      path: "packages/desktop-electron",
      kind: "either",
    })
    // A line range only makes sense for a file.
    expect(parseFileReference("bin/opencode:12")).toEqual({ path: "bin/opencode", start: 12, end: 12 })
    expect(parseFileReference("notes/:12")).toBeUndefined()
  })

  test("ignores code, bare words and URLs", () => {
    expect(parseFileReference("sync.data.session")).toBeUndefined()
    expect(parseFileReference("notes")).toBeUndefined()
    expect(parseFileReference("/")).toBeUndefined()
    expect(parseFileReference("https://opencode.ai/docs.html")).toBeUndefined()
    expect(parseFileReference("a.ts:12-x")).toBeUndefined()
    expect(parseFileReference("foo(bar.ts)")).toBeUndefined()
    expect(parseFileReference("1.2")).toBeUndefined()
  })
})

describe("settleFileReference", () => {
  const settle = (text: string, type?: "file" | "directory") => {
    const reference = parseFileReference(text)
    return reference && settleFileReference(reference, type)
  }

  test("keeps an extensionless path plain until the listing names it", () => {
    const prose = [
      "owner/repo",
      "and/or",
      "input/output",
      "application/json",
      "origin/main",
      "@types/node",
      "CI/CD",
      "1/2",
      "github.com/a/b",
      "localhost:3000/api",
      "owner/repo#12",
      "x/y,",
    ]
    prose.forEach((text) => expect(settle(text)).toBeUndefined())
  })

  test("turns a listed extensionless path into a file or folder chip", () => {
    expect(settle("src/components", "directory")).toEqual({ path: "src/components", kind: "folder" })
    expect(settle("bin/opencode", "file")).toEqual({ path: "bin/opencode" })
  })

  test("leaves files and trailing-slash folders as parsed", () => {
    expect(settle("src/app.tsx:3")).toEqual({ path: "src/app.tsx", start: 3, end: 3 })
    expect(settle("notes/")).toEqual({ path: "notes/", kind: "folder" })
  })
})

describe("resolveFileReferencePath", () => {
  test("normalizes paths relative to the thread directory", () => {
    expect(resolveFileReferencePath("core/src/harness.ts", "/repo")).toBe("core/src/harness.ts")
    expect(resolveFileReferencePath("./core//src/./harness.ts", "/repo")).toBe("core/src/harness.ts")
    expect(resolveFileReferencePath("notes/", "/repo")).toBe("notes")
    expect(resolveFileReferencePath("src\\components\\", "C:\\repo")).toBe("src/components")
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
    expect(resolveFileReferencePath("../notes/", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("./", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("/etc/", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("notes\u0007/", "/repo")).toBeUndefined()
    expect(resolveFileReferencePath("..\\secret.txt", "C:\\repo")).toBeUndefined()
    expect(resolveFileReferencePath("D:\\repo\\a.ts", "C:\\repo")).toBeUndefined()
    // Drive-relative paths resolve against that drive's current folder, not the thread folder.
    expect(resolveFileReferencePath("D:x.ts", "C:\\repo")).toBeUndefined()
    expect(resolveFileReferencePath("c:core\\a.ts", "C:\\repo")).toBeUndefined()
    expect(resolveFileReferencePath("D:x.ts", "/repo")).toBeUndefined()
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

describe("listedEntryPath", () => {
  test("matches a listed folder to the path a reference resolves to", () => {
    expect(listedEntryPath("research/")).toBe("research")
    expect(listedEntryPath("docs/research//")).toBe("docs/research")
    expect(listedEntryPath("docs\\research\\")).toBe("docs/research")
    expect(listedEntryPath("src/index.ts")).toBe("src/index.ts")
    expect(resolveFileReferencePath("research/", "/repo")).toBe(listedEntryPath("research/"))
  })
})

describe("fileCitations", () => {
  test("rewrites Codex citation directives as cited paths", () => {
    expect(fileCitations('Done.\n\n:codex-file-citation{path="/repo/report.docx" purpose="output"}\n')).toBe(
      "Done.\n\n`/repo/report.docx`\n",
    )
    expect(fileCitations('See ::codex-file-citation{path="src/a.ts" line_range_start=10 line_range_end=12}.')).toBe(
      "See `src/a.ts:10-12`.",
    )
    expect(fileCitations("::codex-file-citation{path='src/a.ts' line_range_start=4}")).toBe("`src/a.ts:4`")
  })

  test("leaves text without a usable path unchanged", () => {
    expect(fileCitations("no citations here")).toBe("no citations here")
    expect(fileCitations(':codex-file-citation{purpose="output"}')).toBe(':codex-file-citation{purpose="output"}')
    expect(fileCitations(':codex-file-citation{path="a`b"}')).toBe(':codex-file-citation{path="a`b"}')
  })
})

describe("localLinkTarget", () => {
  test("reads relative paths and file URLs as local files", () => {
    expect(localLinkTarget("pragma-project-report.docx")).toBe("pragma-project-report.docx")
    expect(localLinkTarget("docs/My%20Notes.md#intro")).toBe("docs/My Notes.md")
    expect(localLinkTarget("file:///Users/me/repo/report.docx")).toBe("/Users/me/repo/report.docx")
    expect(localLinkTarget("file:///C:/repo/a.ts")).toBe("C:/repo/a.ts")
    expect(localLinkTarget("/Users/me/repo/a.ts")).toBe("/Users/me/repo/a.ts")
  })

  test("ignores web, mail, other schemes, anchors and remote file URLs", () => {
    for (const href of [
      "https://example.com/a.ts",
      "mailto:a@b.c",
      "javascript:alert(1)",
      "#section",
      "//host/a",
      "file://server/share/a.ts",
      "",
    ])
      expect(localLinkTarget(href)).toBeUndefined()
  })
})

describe("parseFileReference with file URLs", () => {
  test("cites the path of a local file URL", () => {
    expect(parseFileReference("file:///Users/me/repo/notes.md")).toEqual({ path: "/Users/me/repo/notes.md" })
    // An extension outside the known list is settled by the folder listing, like any extensionless path.
    expect(parseFileReference("file:///Users/me/repo/report.docx")).toEqual({
      path: "/Users/me/repo/report.docx",
      kind: "either",
    })
    expect(resolveFileReferencePath("/Users/me/repo/report.docx", "/Users/me/repo")).toBe("report.docx")
  })
})
