import { expect, test } from "bun:test"
import type { NoteSummary, ProjectRecord } from "@/features/second-brain/client"
import { projectGraph } from "./projects"

test("builds a bounded Project-centered note graph", () => {
  const project = {
    id: "project_01K4B",
    folder: "projects/project_01K4B",
    name: "Launch",
    outcome: "Ship",
    instructions: "",
    status: "active",
    progressPercent: 0,
    tags: [],
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  } satisfies ProjectRecord
  const notes = [
    {
      path: "notes/brief.md",
      title: "Brief",
      projectIds: [project.id],
      tags: [],
      links: ["Decision"],
      updatedAt: project.updatedAt,
    },
    {
      path: "notes/decision.md",
      title: "Decision",
      projectIds: [project.id],
      tags: [],
      links: [],
      updatedAt: project.updatedAt,
    },
  ] satisfies NoteSummary[]

  const graph = projectGraph(project, notes)
  expect(graph.nodes).toHaveLength(3)
  expect(graph.edges).toHaveLength(3)
  expect(graph.edges.filter((edge) => !edge.project)).toHaveLength(1)
})
