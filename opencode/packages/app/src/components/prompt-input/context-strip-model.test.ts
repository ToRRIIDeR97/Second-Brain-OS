import { describe, expect, test } from "bun:test"
import type { ProjectThreads } from "@/features/second-brain/client"
import { contextTokenRows, instructionsLabel, threadProject } from "./context-strip-model"

const entry = (
  id: string,
  threadDirectory: string,
  status: ProjectThreads["project"]["status"] = "active",
): ProjectThreads => ({
  project: {
    id,
    folder: threadDirectory,
    name: id,
    outcome: "",
    instructions: "",
    status,
    progressPercent: 0,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  threadDirectory,
  threadDirectoryKind: "project",
  workspace: null,
  rootSessionCount: 0,
  lastActivityAt: null,
})

const entries = [
  entry("prj_site", "/brain/projects/site"),
  entry("prj_docs", "/brain/projects/site/docs"),
  entry("prj_old", "/brain/projects/old", "paused"),
  entry("prj_repo", "/work/repo"),
]
const workspaces = [{ worktree: "/brain" }, { worktree: "/other", name: "Side work" }]

const resolve = (directory: string | undefined) =>
  threadProject({ entries, workspaceDirectory: "/brain", workspaces, directory })

describe("context strip Project", () => {
  test("picks the deepest active Project folder holding the thread, like the sidebar", () => {
    expect(resolve("/brain/projects/site/docs/api")).toMatchObject({
      kind: "project",
      entry: { threadDirectory: "/brain/projects/site/docs" },
    })
    expect(resolve("/brain/projects/site")).toMatchObject({ kind: "project", entry: { project: { id: "prj_site" } } })
    expect(resolve("/work/repo/")).toMatchObject({ kind: "project", entry: { project: { id: "prj_repo" } } })
  })

  test("shows General for workspace threads outside every active Project", () => {
    expect(resolve("/brain")).toEqual({ kind: "general" })
    expect(resolve("/brain/projects/old")).toEqual({ kind: "general" })
  })

  test("names threads outside the workspace after the open workspace or folder holding them", () => {
    expect(resolve("/other/sub")).toEqual({ kind: "folder", name: "Side work" })
    expect(resolve("/elsewhere/tool")).toEqual({ kind: "folder", name: "tool" })
    expect(resolve(undefined)).toBeUndefined()
  })
})

describe("context strip helpers", () => {
  test("lists only the reported token parts", () => {
    expect(contextTokenRows({ input: 1200, output: 300, reasoning: 0, cache: { read: 5000, write: 0 } })).toEqual([
      { key: "input", value: 1200 },
      { key: "cacheRead", value: 5000 },
      { key: "output", value: 300 },
    ])
  })

  test("shows an instructions path relative to the workspace when inside it", () => {
    expect(instructionsLabel("/brain/projects/site/AGENTS.md", "/brain/")).toBe("projects/site/AGENTS.md")
    expect(instructionsLabel("/brain/AGENTS.md", "/brain")).toBe("AGENTS.md")
    expect(instructionsLabel("/work/repo/AGENTS.md", "/brain")).toBe("/work/repo/AGENTS.md")
    expect(instructionsLabel("/brain/AGENTS.md", undefined)).toBe("/brain/AGENTS.md")
  })
})
