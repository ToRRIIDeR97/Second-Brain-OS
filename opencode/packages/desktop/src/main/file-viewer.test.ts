import { describe, expect, mock, test } from "bun:test"

mock.module("electron", () => ({ net: {}, protocol: {} }))
const { resolveInside } = await import("./file-viewer")

describe("resolveInside", () => {
  const root = process.platform === "win32" ? String.raw`C:\work\repo` : "/work/repo"

  test("resolves a file inside the folder", () => {
    expect(resolveInside(root, "docs/spec.pdf")?.replaceAll("\\", "/")).toMatch(/\/work\/repo\/docs\/spec\.pdf$/)
  })

  test("refuses paths that leave the folder, the folder itself, and relative folders", () => {
    expect(resolveInside(root, "../secret.txt")).toBeUndefined()
    expect(resolveInside(root, "docs/../../secret.txt")).toBeUndefined()
    expect(resolveInside(root, "")).toBeUndefined()
    expect(resolveInside("relative/repo", "a.txt")).toBeUndefined()
  })
})
