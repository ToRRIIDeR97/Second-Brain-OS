import { describe, expect, test } from "bun:test"
import type { SessionApi, SessionInfo, SessionListInput } from "@opencode-ai/client/promise"
import { Harness } from "@opencode-ai/schema/harness"
import { listAllSessions, normalizeSessionInfo, revertRestoresFiles, sessionPinnedAt } from "./session"

describe("normalizeSessionInfo", () => {
  test("adapts a current session to the app session shape", () => {
    const result = normalizeSessionInfo({
      id: "session-1",
      projectID: "project-1",
      agent: "build",
      model: { id: "gpt-5", providerID: "openai", variant: "high" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      title: "New session",
      location: { directory: "/repo/worktree", workspaceID: "workspace-1" },
      subpath: "worktree",
      revert: { messageID: "message-1", partID: "part-1", snapshot: "snapshot", files: [] },
    } as SessionInfo)

    expect(result).toEqual({
      id: "session-1",
      slug: "session-1",
      projectID: "project-1",
      workspaceID: "workspace-1",
      directory: "/repo/worktree",
      path: "worktree",
      parentID: undefined,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      title: "New session",
      agent: "build",
      harnessInstanceID: Harness.OpenCode,
      harnessModel: undefined,
      harnessRevision: undefined,
      model: { id: "gpt-5", providerID: "openai", variant: "high" },
      version: "",
      time: { created: 1, updated: 1 },
      revert: { messageID: "message-1", partID: "part-1", snapshot: "snapshot", diff: "" },
    })
  })

  test("reads the harness from metadata on the legacy shape", () => {
    const legacy = {
      id: "session-1",
      time: { created: 1, updated: 1 },
      metadata: { harnessInstanceID: "codex", harnessModel: { id: "gpt-5.5" }, harnessRevision: 3 },
    } as unknown as Parameters<typeof normalizeSessionInfo>[0]
    const result = normalizeSessionInfo(legacy)
    expect(result.harnessInstanceID).toBe(Harness.InstanceID.make("codex"))
    expect(result.harnessModel).toEqual({ id: "gpt-5.5" })
    expect(result.harnessRevision).toBe(3)

    const topLevel = normalizeSessionInfo({
      ...legacy,
      harnessInstanceID: "claude-code",
    } as unknown as Parameters<typeof normalizeSessionInfo>[0])
    expect(topLevel.harnessInstanceID).toBe(Harness.InstanceID.make("claude-code"))

    const invalid = normalizeSessionInfo({
      id: "session-2",
      time: { created: 1, updated: 1 },
      metadata: { harnessInstanceID: "", harnessModel: { name: "x" }, harnessRevision: "1" },
    } as unknown as Parameters<typeof normalizeSessionInfo>[0])
    expect(invalid.harnessInstanceID).toBe(Harness.OpenCode)
    expect(invalid.harnessModel).toBeUndefined()
    expect(invalid.harnessRevision).toBeUndefined()
  })

  test("maps the current pin time onto legacy metadata", () => {
    const pinned = { ...currentSession("session-1"), time: { created: 1, updated: 1, pinned: 7 } } as SessionInfo
    expect(sessionPinnedAt(normalizeSessionInfo(pinned))).toBe(7)
    expect(sessionPinnedAt(normalizeSessionInfo(currentSession("session-2")))).toBeUndefined()
    expect(sessionPinnedAt({ metadata: { pinned: true } })).toBeUndefined()
  })

  test("supplies timestamped titles for untitled current sessions", () => {
    const root = currentSession("session-1")
    const child = currentSession("session-2", "session-1")

    expect(normalizeSessionInfo(root).title).toBe("New session - 1970-01-01T00:00:00.000Z")
    expect(normalizeSessionInfo(child).title).toBe("Child session - 1970-01-01T00:00:00.000Z")
  })
})

describe("revertRestoresFiles", () => {
  test("keeps a messages-only rewind file-free when the boundary moves forward", () => {
    // Current shape: a staged rewind with no file changes normalizes to an empty diff.
    const current = normalizeSessionInfo({
      ...currentSession("session-1"),
      revert: { messageID: "message-1", files: [] },
    } as unknown as SessionInfo)
    expect(revertRestoresFiles(current.revert)).toBe(false)
    // Legacy shape (session.updated events) carries the stored diff.
    expect(revertRestoresFiles({ diff: "" })).toBe(false)
    expect(revertRestoresFiles({ diff: "patch a.ts\n" })).toBe(true)
    expect(revertRestoresFiles(undefined)).toBeUndefined()
  })
})

describe("listAllSessions", () => {
  test("loads every page in server order and retains the query", async () => {
    const calls: SessionListInput[] = []
    const pages = new Map<string | undefined, { data: SessionInfo[]; cursor: { next?: string } }>([
      [undefined, { data: [sessionInfo("session-3"), sessionInfo("session-2")], cursor: { next: "next" } }],
      ["next", { data: [sessionInfo("session-1", true)], cursor: {} }],
    ])
    const api = {
      list: async (query = {}) => {
        calls.push(query)
        return pages.get(query.cursor) ?? { data: [], cursor: {} }
      },
    } satisfies Pick<SessionApi, "list">

    const result = await listAllSessions(api, { directory: "/repo", order: "desc" })

    expect(result.map((session) => session.id)).toEqual(["session-3", "session-2", "session-1"])
    expect(result[2]?.time.archived).toBe(2)
    expect(calls).toEqual([
      { directory: "/repo", order: "desc", limit: 100, cursor: undefined },
      { directory: "/repo", order: "desc", limit: 100, cursor: "next" },
    ])
  })

  test("requests the terminal empty page when the server returns a next cursor", async () => {
    const cursors: Array<string | undefined> = []
    const api = {
      list: async (query = {}) => {
        cursors.push(query.cursor)
        if (query.cursor) return { data: [], cursor: { next: "unused" } }
        return { data: [sessionInfo("session-1")], cursor: { next: "terminal" } }
      },
    } satisfies Pick<SessionApi, "list">

    const result = await listAllSessions(api, { directory: "/repo", limit: 25 })

    expect(result.map((session) => session.id)).toEqual(["session-1"])
    expect(cursors).toEqual([undefined, "terminal"])
  })
})

function sessionInfo(id: string, archived = false) {
  return {
    id,
    projectID: "project-1",
    agent: "build",
    model: { id: "model-1", providerID: "provider-1" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1, archived: archived ? 2 : undefined },
    title: id,
    location: { directory: "/repo" },
  } as SessionInfo
}

function currentSession(id: string, parentID?: string) {
  return {
    id,
    parentID,
    projectID: "project-1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/repo" },
  } as SessionInfo
}
