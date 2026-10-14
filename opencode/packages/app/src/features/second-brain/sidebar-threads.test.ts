import { describe, expect, test } from "bun:test"
import { buildThreadTree, flattenThreads, groupSidebarThreads, projectForDirectory } from "./sidebar-threads"

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
  test("puts threads under the Project with the exact thread directory", () => {
    const groups = groupSidebarThreads({
      projects,
      brainDirectory: "/brain",
      sessions: [
        session("a", "/work/repo", 1),
        session("b", "/brain/projects/prj_notes/", 2),
        session("c", "/brain", 3),
        session("d", "/tmp/scratch", 4),
      ],
    })

    expect(groups.projects.map((group) => [group.project.id, group.threads.map((node) => node.session.id)])).toEqual([
      ["prj_repo", ["a"]],
      ["prj_notes", ["b"]],
    ])
    expect(groups.brain.map((node) => node.session.id)).toEqual(["c"])
    expect(groups.other.map((node) => node.session.id)).toEqual(["d"])
  })

  test("does not let a Brain-folder Project absorb the Brain's own threads", () => {
    const groups = groupSidebarThreads({
      projects,
      brainDirectory: "/brain",
      sessions: [session("root", "/brain", 1), session("sub", "/brain/projects/other", 2)],
    })

    expect(groups.brain.map((node) => node.session.id)).toEqual(["root"])
    expect(groups.other.map((node) => node.session.id)).toEqual(["sub"])
  })

  test("without a Brain every unmatched thread is in Other threads", () => {
    const groups = groupSidebarThreads({ projects: [], sessions: [session("a", "/brain", 1)] })
    expect(groups.brain).toEqual([])
    expect(groups.other.map((node) => node.session.id)).toEqual(["a"])
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

  test("matches thread directories regardless of a trailing slash", () => {
    expect(projectForDirectory(projects, "/work/repo/")?.id).toBe("prj_repo")
    expect(projectForDirectory(projects, "/work/repo/src")).toBeUndefined()
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
      brainDirectory: "/brain",
      sessions: [
        session("a", "/work/repo", 1, { updated: 9 }),
        session("b", "/work/repo", 2, { pinned: 5 }),
        session("c", "/brain", 3, { updated: 9 }),
        session("d", "/brain", 4, { pinned: 5 }),
        session("e", "/tmp", 5, { updated: 9 }),
        session("f", "/tmp", 6, { pinned: 5 }),
      ],
    })
    expect(groups.projects[0]?.threads.map((node) => node.session.id)).toEqual(["b", "a"])
    expect(groups.brain.map((node) => node.session.id)).toEqual(["d", "c"])
    expect(groups.other.map((node) => node.session.id)).toEqual(["f", "e"])
  })

  test("keeps a child whose parent is not loaded as a root", () => {
    const tree = buildThreadTree([session("orphan", "/w", 1, { parentID: "missing" })])
    expect(tree.map((node) => node.session.id)).toEqual(["orphan"])
  })
})
