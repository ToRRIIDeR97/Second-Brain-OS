import { describe, expect, test } from "bun:test"
import type {
  CalendarEvent,
  CalendarSnapshot,
  NoteSummary,
  PlannerTask,
  ProjectRecord,
} from "@/features/second-brain/client"
import { filterProjectOverview, groupProjectOverview } from "./project-overview"

const project = (id: string, name: string, extra: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id,
  folder: `projects/${id}`,
  name,
  outcome: "",
  instructions: "",
  status: "active",
  progressPercent: 0,
  tags: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...extra,
})
const note = (path: string, projectIds: string[], updatedAt: string, title = path): NoteSummary => ({
  path,
  title,
  projectIds,
  tags: [],
  links: [],
  updatedAt,
})
const event = (id: string, date: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  date,
  source: "local",
  syncState: "local",
  ...extra,
})
const task = (id: string, extra: Partial<PlannerTask> = {}): PlannerTask => ({
  id,
  title: id,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  source: "local",
  syncState: "local",
  ...extra,
})
const calendar = (events: CalendarEvent[], tasks: PlannerTask[] = []): CalendarSnapshot => ({
  version: 2,
  revision: "r1",
  events,
  tasks,
})
const today = "2026-10-29"

describe("groupProjectOverview", () => {
  test("gives every Project a group in the given order, even an empty one", () => {
    const groups = groupProjectOverview({
      projects: [project("b", "Beta", { status: "paused" }), project("a", "Alpha")],
      notes: [],
      today,
    })
    expect(groups).toEqual([
      { projectId: "b", name: "Beta", status: "paused", notes: [], items: [] },
      { projectId: "a", name: "Alpha", status: "active", notes: [], items: [] },
    ])
  })

  test("sets the next milestone only when it is not blank, trimmed", () => {
    const groups = groupProjectOverview({
      projects: [
        project("a", "A", { nextMilestone: "  Beta launch  " }),
        project("b", "B", { nextMilestone: "   " }),
        project("c", "C", { nextMilestone: null }),
      ],
      notes: [],
      today,
    })
    expect(groups.map((group) => group.nextMilestone)).toEqual(["Beta launch", undefined, undefined])
    expect("nextMilestone" in groups[1]).toBe(false)
  })

  test("puts unlinked and unknown-Project content in a trailing workspace group", () => {
    const groups = groupProjectOverview({
      projects: [project("a", "A")],
      notes: [note("loose.md", [], "2026-10-02"), note("ghost.md", ["gone"], "2026-10-01"), note("a.md", ["a"], "x")],
      calendar: calendar([event("e1", today), event("e2", today, { projectId: "gone" })], [task("t1")]),
      today,
    })
    expect(groups).toHaveLength(2)
    const workspace = groups[1]
    expect(workspace.projectId).toBeUndefined()
    expect(workspace.name).toBe("")
    expect(workspace.status).toBeUndefined()
    expect(workspace.notes.map((item) => item.path)).toEqual(["loose.md", "ghost.md"])
    expect(workspace.items.map((item) => item.id)).toEqual(["event:e1", "event:e2", "task:t1"])
    expect(groups[0].notes.map((item) => item.path)).toEqual(["a.md"])
  })

  test("leaves the workspace group out when it is empty", () => {
    const groups = groupProjectOverview({
      projects: [project("a", "A")],
      notes: [note("a.md", ["a"], "2026-10-01")],
      calendar: calendar([event("e1", today, { projectId: "a" })]),
      today,
    })
    expect(groups.map((group) => group.projectId)).toEqual(["a"])
    expect(groupProjectOverview({ projects: [], notes: [], today })).toEqual([])
  })

  test("shows a note linked to several Projects in each of them, and once per Project", () => {
    const shared = note("shared.md", ["a", "b", "a", "gone"], "2026-10-01")
    const groups = groupProjectOverview({ projects: [project("a", "A"), project("b", "B")], notes: [shared], today })
    expect(groups.map((group) => group.notes)).toEqual([[shared], [shared]])
  })

  test("sorts notes newest first", () => {
    const groups = groupProjectOverview({
      projects: [project("a", "A")],
      notes: [
        note("old.md", ["a"], "2026-09-01T00:00:00.000Z"),
        note("new.md", ["a"], "2026-10-20T00:00:00.000Z"),
        note("mid.md", ["a"], "2026-10-01T00:00:00.000Z"),
      ],
      today,
    })
    expect(groups[0].notes.map((item) => item.path)).toEqual(["new.md", "mid.md", "old.md"])
  })

  test("keeps events from today on, including multi-day events still running", () => {
    const groups = groupProjectOverview({
      projects: [project("a", "A")],
      notes: [],
      calendar: calendar([
        event("past", "2026-10-28", { projectId: "a" }),
        event("today", today, { projectId: "a" }),
        event("running", "2026-10-27", { endDate: "2026-10-30", projectId: "a" }),
        event("ended", "2026-10-25", { endDate: "2026-10-28", projectId: "a" }),
        event("later", "2026-11-02", { projectId: "a", source: "google" }),
      ]),
      today,
    })
    expect(groups[0].items).toEqual([
      { kind: "event", id: "event:running", title: "running", date: "2026-10-27", source: "local" },
      { kind: "event", id: "event:today", title: "today", date: today, source: "local" },
      { kind: "event", id: "event:later", title: "later", date: "2026-11-02", source: "google" },
    ])
  })

  test("keeps incomplete tasks dated by their scheduled, then due, date", () => {
    const groups = groupProjectOverview({
      projects: [project("a", "A")],
      notes: [],
      calendar: calendar(
        [],
        [
          task("done", { projectId: "a", completedAt: "2026-10-20T00:00:00.000Z" }),
          task("both", { projectId: "a", scheduledDate: "2026-11-01", dueDate: "2026-11-05" }),
          task("due", { projectId: "a", dueDate: "2026-10-30" }),
          task("overdue", { projectId: "a", dueDate: "2026-10-01" }),
          task("undated", { projectId: "a" }),
        ],
      ),
      today,
    })
    expect(groups[0].items.map((item) => [item.kind, item.id, item.date])).toEqual([
      ["task", "task:overdue", "2026-10-01"],
      ["task", "task:due", "2026-10-30"],
      ["task", "task:both", "2026-11-01"],
      ["task", "task:undated", undefined],
    ])
  })

  test("sorts items by date, undated last, then by title", () => {
    const groups = groupProjectOverview({
      projects: [],
      notes: [],
      calendar: calendar(
        [event("1", "2026-11-01", { title: "Zeta" }), event("2", "2026-11-01", { title: "Alpha" })],
        [task("3", { title: "Beta" }), task("4", { title: "Aardvark" }), task("5", { title: "Gamma", dueDate: today })],
      ),
      today,
    })
    expect(groups[0].items.map((item) => item.title)).toEqual(["Gamma", "Alpha", "Zeta", "Aardvark", "Beta"])
  })

  test("works without a calendar and never mutates its input", () => {
    const projects = Object.freeze([Object.freeze(project("a", "A"))])
    const notes = Object.freeze([
      Object.freeze(note("1.md", ["a"], "2026-09-01")),
      Object.freeze(note("2.md", ["a"], "2026-10-01")),
    ])
    const snapshot = calendar([event("e", "2026-11-02"), event("d", "2026-11-01")], [task("t")])
    const before = structuredClone({ projects, notes, snapshot })
    const groups = groupProjectOverview({ projects, notes, calendar: Object.freeze(snapshot), today })
    expect(structuredClone({ projects, notes, snapshot })).toEqual(before)
    expect(groups[0].notes.map((item) => item.path)).toEqual(["2.md", "1.md"])
    expect(groupProjectOverview({ projects, notes, today })[0].items).toEqual([])
  })
})

describe("filterProjectOverview", () => {
  const groups = groupProjectOverview({
    projects: [project("a", "Launch"), project("b", "Research")],
    notes: [
      note("a1.md", ["a"], "2026-10-02", "Pricing brief"),
      note("a2.md", ["a"], "2026-10-01", "Press list"),
      note("b1.md", ["b"], "2026-10-01", "Interview notes"),
      note("w1.md", [], "2026-10-01", "Inbox"),
    ],
    calendar: calendar([event("e1", today, { projectId: "b", title: "Pricing review" })]),
    today,
  })

  test("returns every group for a blank query", () => {
    expect(filterProjectOverview(groups, "  ")).toEqual(groups)
  })

  test("narrows notes and items by title, ignoring case, and drops groups with no match", () => {
    const filtered = filterProjectOverview(groups, "PRICING")
    expect(filtered.map((group) => group.projectId)).toEqual(["a", "b"])
    expect(filtered[0].notes.map((item) => item.path)).toEqual(["a1.md"])
    expect(filtered[1].notes).toEqual([])
    expect(filtered[1].items.map((item) => item.id)).toEqual(["event:e1"])
  })

  test("keeps all content of a Project whose name matches", () => {
    const filtered = filterProjectOverview(groups, "launch")
    expect(filtered).toEqual([groups[0]])
  })

  test("matches the workspace group by its content only", () => {
    expect(filterProjectOverview(groups, "inbox").map((group) => group.name)).toEqual([""])
    expect(filterProjectOverview(groups, "nothing here")).toEqual([])
  })
})
