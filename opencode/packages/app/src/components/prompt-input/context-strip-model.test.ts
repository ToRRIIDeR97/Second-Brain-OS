import { describe, expect, test } from "bun:test"
import { contextTokenRows, formatResetIn, formatShare, threadUsage, threadWorktree } from "./context-strip-model"

describe("usage limits", () => {
  test("shows only the thread's own harness, and nothing for one that doesn't report usage", () => {
    const reports = [
      { instanceID: "codex", status: "available" },
      { instanceID: "claude-code", status: "signed-out" },
      { instanceID: "opencode-acp", status: "unsupported" },
    ]
    expect(threadUsage(reports, "claude-code")).toEqual({ instanceID: "claude-code", status: "signed-out" })
    expect(threadUsage(reports, "opencode-acp")).toBeUndefined()
    expect(threadUsage(reports, "opencode")).toBeUndefined()
    expect(threadUsage(reports, undefined)).toBeUndefined()
  })

  test("says how far off a reset is in minutes, hours, or days", () => {
    const now = 1_000_000
    expect(formatResetIn(now + 20 * 60_000, now, "en")).toBe("in 20 minutes")
    expect(formatResetIn(now + 3 * 3_600_000, now, "en")).toBe("in 3 hours")
    expect(formatResetIn(now + 5 * 86_400_000, now, "en")).toBe("in 5 days")
    expect(formatResetIn(now - 60_000, now, "en")).toBe("in 1 minute")
    expect(formatResetIn(now + 3 * 3_600_000, now, "de")).toBe("in 3 Stunden")
  })
})

const project = { worktree: "/work/repo", sandboxes: ["/work/.worktrees/quirky-thompson", "/tmp/clone/"] }

describe("context strip worktree", () => {
  test("names a linked worktree after its folder", () => {
    expect(threadWorktree({ directory: "/work/.worktrees/quirky-thompson/", project })).toEqual({
      name: "quirky-thompson",
      linked: true,
    })
    expect(threadWorktree({ directory: "/tmp/clone", project })).toEqual({ name: "clone", linked: true })
  })

  test("shows the folder name for the main checkout and folders outside Git", () => {
    expect(threadWorktree({ directory: "/work/repo", project })).toEqual({ name: "repo", linked: false })
    expect(threadWorktree({ directory: "C:\\work\\notes", project: undefined })).toEqual({
      name: "notes",
      linked: false,
    })
    expect(threadWorktree({ directory: undefined, project })).toBeUndefined()
  })
})

describe("context strip tokens", () => {
  test("lists only the reported token parts, cache first", () => {
    expect(contextTokenRows({ input: 1200, output: 300, reasoning: 0, cache: { read: 5000, write: 0 } })).toEqual([
      { key: "cacheRead", value: 5000 },
      { key: "input", value: 1200 },
      { key: "output", value: 300 },
    ])
  })

  test("formats a share of the context window", () => {
    expect(formatShare(78_720, 200_000, "en")).toBe("39%")
    expect(formatShare(648, 200_000, "en")).toBe("0.3%")
    expect(formatShare(20, 200_000, "en")).toBe("<0.1%")
    expect(formatShare(0, 200_000, "en")).toBe("0%")
  })
})
