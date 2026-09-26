import type { NoteSummary, ProjectRecord } from "./client"
import { normalizeWikiTarget } from "./note-links"

type ProjectGraphNode = { id: string; label: string; x: number; y: number; project: boolean }

export function projectGraph(project: ProjectRecord, notes: ReadonlyArray<NoteSummary>) {
  const root: ProjectGraphNode = { id: project.id, label: project.name, x: 400, y: 210, project: true }
  const nodes = notes.map((note, index): ProjectGraphNode => {
    const angle = (index / Math.max(notes.length, 1)) * Math.PI * 2 - Math.PI / 2
    return {
      id: note.path,
      label: note.title,
      x: 400 + Math.cos(angle) * 305,
      y: 210 + Math.sin(angle) * 155,
      project: false,
    }
  })
  const byKey = new Map<string, ProjectGraphNode>()
  for (const [index, note] of notes.entries()) {
    const node = nodes[index]!
    for (const key of [note.title, note.path, note.path.split(/[\\/]/).pop() ?? note.path]) {
      byKey.set(normalizeGraphKey(key), node)
    }
  }
  const edges: { from: ProjectGraphNode; to: ProjectGraphNode; project: boolean }[] = nodes.map((node) => ({
    from: root,
    to: node,
    project: true,
  }))
  const seen = new Set<string>()
  for (const [index, note] of notes.entries()) {
    const from = nodes[index]!
    for (const link of note.links) {
      const to = byKey.get(normalizeGraphKey(link))
      if (!to || to.id === from.id) continue
      const key = [from.id, to.id].sort().join("\0")
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from, to, project: false })
    }
  }
  return { nodes: [root, ...nodes], edges }
}

function normalizeGraphKey(value: string) {
  return normalizeWikiTarget(
    value
      .split("#", 1)[0]!
      .trim()
      .replace(/^notes\//i, ""),
  )
}
