import { expect, test } from "bun:test"
import type { NoteSummary, ProjectRecord } from "./client"
import { projectGraph } from "./project-graph"

const project: ProjectRecord = {
  id: "project_1",
  folder: "projects/alpha",
  name: "Alpha",
  outcome: "Ship",
  instructions: "",
  status: "active",
  progressPercent: 0,
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

const note = (path: string, title: string, links: string[]): NoteSummary => ({
  path,
  title,
  projectIds: [project.id],
  tags: [],
  links,
  updatedAt: "2026-01-01T00:00:00.000Z",
})

const noteEdges = (notes: NoteSummary[]) =>
  projectGraph(project, notes)
    .edges.filter((edge) => !edge.project)
    .map((edge) => `${edge.from.id} -> ${edge.to.id}`)

test("every note links to the Project node", () => {
  const graph = projectGraph(project, [note("notes/a.md", "A", []), note("notes/b.md", "B", [])])
  expect(graph.nodes.map((node) => node.id)).toEqual(["project_1", "notes/a.md", "notes/b.md"])
  expect(graph.edges.filter((edge) => edge.project)).toHaveLength(2)
})

test("links with a heading or block suffix and a notes/ prefix resolve to the note", () => {
  expect(
    noteEdges([
      note("notes/a.md", "A", ["B#Goals"]),
      note("notes/b.md", "B", []),
      note("notes/c.md", "C", ["notes/a.md#^block"]),
    ]),
  ).toEqual(["notes/a.md -> notes/b.md", "notes/c.md -> notes/a.md"])
})

test("links in both directions draw one edge, and self-links draw none", () => {
  expect(noteEdges([note("notes/a.md", "A", ["B", "A", "a#Intro"]), note("notes/b.md", "B", ["A"])])).toEqual([
    "notes/a.md -> notes/b.md",
  ])
})

test("unresolved links draw no edge", () => {
  expect(noteEdges([note("notes/a.md", "A", ["Missing"])])).toEqual([])
})
