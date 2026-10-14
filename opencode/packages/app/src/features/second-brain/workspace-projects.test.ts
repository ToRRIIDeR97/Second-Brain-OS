import { expect, test } from "bun:test"
import { createWorkspaceProjectTracker } from "./workspace-projects"

test("only newly opened Workspaces with an id are ensured, once each", () => {
  const tracker = createWorkspaceProjectTracker()
  const brain = { id: "proj_brain", worktree: "/brain" }
  expect(tracker.next({ workspaces: [brain, { id: "proj_old", worktree: "/old" }] })).toEqual([])

  // Opened folders are prepended and have no id until the server resolves them.
  expect(tracker.next({ workspaces: [{ worktree: "/new" }, brain] })).toEqual([])
  expect(tracker.next({ workspaces: [{ id: "proj_new", worktree: "/new" }, brain] })).toEqual([
    { id: "proj_new", worktree: "/new", brainDirectory: "/brain" },
  ])
  expect(tracker.next({ workspaces: [{ id: "proj_new", worktree: "/new" }, brain] })).toEqual([])
})

test("skips the shared global project and the selected Brain directory", () => {
  const tracker = createWorkspaceProjectTracker()
  tracker.next({ workspaces: [] })
  const workspaces = [
    { id: "global", worktree: "/tmp/scratch" },
    { id: "proj_brain", worktree: "/brain" },
  ]
  expect(tracker.next({ workspaces, brainDirectory: "/brain" })).toEqual([])
})
