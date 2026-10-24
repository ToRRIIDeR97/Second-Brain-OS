import { describe, expect, test } from "bun:test"
import {
  buildThreadTree,
  createThreadNodeCache,
  flattenThreads,
  groupSidebarThreads,
  projectForDirectory,
} from "./sidebar-threads"

const session = (
  id: string,
  directory: string,
  created: number,
  extra: { parentID?: string; updated?: number; archived?: number; pinned?: number } = {},
) => ({
  id,
  directory,
  parentID: extra.parentID,
  time: { created, updated: extra.updated, archived: extra.archived },
  metadata: extra.pinned === undefined ? undefined : { pinned: extra.pinned },
})

const projects = [
  { id: "prj_repo", threadDirectory: "/work/repo" },
  { id: "prj_notes", threadDirectory: "/brain/projects/prj_notes" },
]

describe("sidebar thread grouping", () => {
  test("puts threads under the Project whose folder holds them, the rest of the workspace in its group", () => {
    const groups = groupSidebarThreads({
      projects,
      workspaceDirectory: "/brain",
      sessions: [
        session("a", "/work/repo", 1),
        session("b", "/brain/projects/prj_notes/", 2),
        session("nested", "/brain/projects/prj_notes/src", 3),
        session("c", "/brain", 4),
        session("dev", "/brain/development/tool", 5),
      ],
    })

    expect(groups.projects.map((group) => [group.project.id, group.threads.map((node) => node.session.id)])).toEqual([
      ["prj_repo", ["a"]],
      ["prj_notes", ["nested", "b"]],
    ])
    expect(groups.workspace.map((node) => node.session.id)).toEqual(["dev", "c"])
  })

  test("leaves out threads from other workspaces so they never mix", () => {
    const groups = groupSidebarThreads({
      projects,
      workspaceDirectory: "/brain",
      sessions: [session("elsewhere", "/Users/me/Default Project", 1), session("tmp", "/tmp/scratch", 2)],
    })
    expect(groups.workspace).toEqual([])
    expect(groups.projects.every((group) => group.threads.length === 0)).toBe(true)
  })

  test("does not treat a folder that only shares a name prefix as inside the workspace", () => {
    const groups = groupSidebarThreads({
      projects: [],
      workspaceDirectory: "/brain",
      sessions: [session("sibling", "/brain-old", 1)],
    })
    expect(groups.workspace).toEqual([])
  })

  test("drops archived threads and duplicate copies of a thread", () => {
    const groups = groupSidebarThreads({
      projects,
      sessions: [
        session("a", "/work/repo", 1),
        session("a", "/work/repo", 1),
        session("gone", "/work/repo", 2, { archived: 5 }),
      ],
    })
    expect(groups.projects[0]?.threads.map((node) => node.session.id)).toEqual(["a"])
  })

  test("matches Project folders regardless of a trailing slash, preferring the deepest", () => {
    expect(projectForDirectory(projects, "/work/repo/")?.id).toBe("prj_repo")
    expect(projectForDirectory(projects, "/work/repo/src")?.id).toBe("prj_repo")
    expect(projectForDirectory(projects, "/work/repository")).toBeUndefined()
    expect(
      projectForDirectory([...projects, { id: "inner", threadDirectory: "/work/repo/pkg" }], "/work/repo/pkg/a")?.id,
    ).toBe("inner")
    expect(projectForDirectory(projects, undefined)).toBeUndefined()
  })
})

describe("thread nesting", () => {
  test("nests children under their parent, roots newest first and children oldest first", () => {
    const tree = buildThreadTree([
      session("old", "/w", 1),
      session("new", "/w", 2, { updated: 10 }),
      session("child-2", "/w", 6, { parentID: "new" }),
      session("child-1", "/w", 5, { parentID: "new" }),
      session("grandchild", "/w", 7, { parentID: "child-1" }),
    ])

    expect(tree.map((node) => node.session.id)).toEqual(["new", "old"])
    expect(tree[0]?.children.map((node) => node.session.id)).toEqual(["child-1", "child-2"])
    expect(tree[0]?.children[0]?.children.map((node) => node.session.id)).toEqual(["grandchild"])
    expect(flattenThreads(tree).map((item) => item.id)).toEqual(["new", "child-1", "grandchild", "child-2", "old"])
  })

  test("puts pinned roots first by pin time, then the rest by last update", () => {
    const tree = buildThreadTree([
      session("recent", "/w", 1, { updated: 50 }),
      session("pinned-old", "/w", 2, { pinned: 10 }),
      session("pinned-new", "/w", 3, { pinned: 20 }),
      session("older", "/w", 4, { updated: 40 }),
      session("pinned-child", "/w", 5, { parentID: "older", pinned: 99 }),
    ])
    expect(tree.map((node) => node.session.id)).toEqual(["pinned-new", "pinned-old", "recent", "older"])
    expect(tree[3]?.children.map((node) => node.session.id)).toEqual(["pinned-child"])
  })

  test("sorts pins within each group", () => {
    const groups = groupSidebarThreads({
      projects,
      workspaceDirectory: "/brain",
      sessions: [
        session("a", "/work/repo", 1, { updated: 9 }),
        session("b", "/work/repo", 2, { pinned: 5 }),
        session("c", "/brain", 3, { updated: 9 }),
        session("d", "/brain", 4, { pinned: 5 }),
      ],
    })
    expect(groups.projects[0]?.threads.map((node) => node.session.id)).toEqual(["b", "a"])
    expect(groups.workspace.map((node) => node.session.id)).toEqual(["d", "c"])
  })

  test("keeps a child whose parent is not loaded as a root", () => {
    const tree = buildThreadTree([session("orphan", "/w", 1, { parentID: "missing" })])
    expect(tree.map((node) => node.session.id)).toEqual(["orphan"])
  })
})

describe("thread node cache", () => {
  test("keeps unchanged nodes and replaces only the changed ones", () => {
    const stable = createThreadNodeCache<ReturnType<typeof session>>()
    const group = (sessions: ReturnType<typeof session>[]) =>
      stable(groupSidebarThreads({ projects, workspaceDirectory: "/brain", sessions }))
    const parent = session("parent", "/work/repo", 1)
    const child = session("child", "/work/repo", 2, { parentID: "parent" })
    const other = session("other", "/work/repo", 3)
    const side = session("side", "/brain", 5)

    const first = group([parent, child, other, side])
    const before = first.projects[0].threads.find((node) => node.session.id === "parent")!
    const second = group([parent, child, other, side])
    expect(second.projects[0].threads).toEqual(first.projects[0].threads)
    second.projects[0].threads.forEach((node, index) => expect(node).toBe(first.projects[0].threads[index]))
    expect(second.workspace[0]).toBe(first.workspace[0])

    // Only `other` changes: its node is new; the parent subtree keeps identity.
    const updated = { ...other, time: { ...other.time, updated: 9 } }
    const [moved, kept] = group([parent, child, updated, side]).projects[0].threads
    expect(moved?.session).toBe(updated)
    expect(kept).toBe(before)
    expect(kept?.children[0]).toBe(before.children[0])

    // A new child replaces its parent's node, since the parent's children changed.
    const sibling = session("sibling", "/work/repo", 6, { parentID: "parent" })
    const regrown = group([parent, child, sibling, updated, side]).projects[0].threads
    const grown = regrown.find((node) => node.session.id === "parent")!
    expect(grown).not.toBe(before)
    expect(grown.children[0]).toBe(before.children[0])
  })
})
