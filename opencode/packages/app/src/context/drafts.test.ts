import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { draftHref, draftsFromLegacyTabs, mergeDrafts, migrateDrafts, sessionStateKey } from "./drafts"
import type { ServerConnection } from "./server"
import { createStateMemory } from "./state-memory"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key

describe("draft store data", () => {
  test("keeps valid drafts and drops malformed ones", () => {
    expect(
      migrateDrafts([
        { draftID: "a", server, directory: "/repo", projectID: "prj_1" },
        { draftID: "b", directory: "/repo" },
        { draftID: "c", server, directory: 3 },
        null,
      ]),
    ).toEqual([{ draftID: "a", server, directory: "/repo", projectID: "prj_1" }])
    expect(migrateDrafts({})).toEqual([])
  })

  test("imports unsent drafts from the retired tab strip and drops session tabs", () => {
    expect(
      draftsFromLegacyTabs(
        [
          { type: "session", server, sessionId: "ses_1" },
          { type: "draft", draftID: "d1", directory: "/repo", worktree: "/repo-wt" },
          { type: "draft", draftID: "d2", server: "remote", directory: "/other" },
          { type: "draft", draftID: "bad" },
        ],
        server,
      ),
    ).toEqual([
      { draftID: "d1", server, directory: "/repo", worktree: "/repo-wt" },
      { draftID: "d2", server: "remote" as ServerConnection.Key, directory: "/other" },
    ])
    expect(draftsFromLegacyTabs(null, server)).toEqual([])
  })

  test("merging legacy drafts does not duplicate existing ones", () => {
    const existing = [{ draftID: "d1", server, directory: "/repo" }]
    expect(
      mergeDrafts(existing, [
        { draftID: "d1", server, directory: "/elsewhere" },
        { draftID: "d2", server, directory: "/repo" },
      ]),
    ).toEqual([...existing, { draftID: "d2", server, directory: "/repo" }])
  })

  test("builds the new-thread route with the Project and draft", () => {
    expect(draftHref({ draftID: "d1", projectID: "prj_1" })).toBe("/new-thread?project=prj_1&draftId=d1")
    expect(draftHref({ draftID: "d 1" })).toBe("/new-thread?draftId=d+1")
    expect(sessionStateKey(server, "ses_1")).toBe(`session:${server}\nses_1`)
  })
})

describe("state memory", () => {
  test("keeps state until its key is removed", () => {
    createRoot((dispose) => {
      const memory = createStateMemory(getOwner())
      let disposed = 0
      const first = memory.ensure("draft:a", "prompt", () => {
        onCleanup(() => disposed++)
        return { value: "prompt" }
      })

      expect(memory.ensure("draft:a", "prompt", () => ({ value: "other" }))).toBe(first)
      expect(memory.get<typeof first>("draft:a", "prompt")).toBe(first)
      expect(memory.get("missing", "prompt")).toBeUndefined()

      memory.remove("draft:a")
      expect(disposed).toBe(1)
      expect(memory.ensure("draft:a", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })

  test("evicts the least recently used key past the limit", () => {
    createRoot((dispose) => {
      const memory = createStateMemory(getOwner(), 2)
      const disposed: string[] = []
      const add = (key: string) =>
        memory.ensure(key, "prompt", () => {
          onCleanup(() => disposed.push(key))
          return key
        })
      add("a")
      add("b")
      add("a")
      add("c")

      expect(disposed).toEqual(["b"])
      expect(memory.get<string>("a", "prompt")).toBe("a")
      expect(memory.get("b", "prompt")).toBeUndefined()
      dispose()
    })
  })
})
