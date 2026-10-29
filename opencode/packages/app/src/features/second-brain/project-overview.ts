import type {
  CalendarSnapshot,
  CalendarSource,
  NoteSummary,
  ProjectRecord,
  ProjectStatus,
} from "@/features/second-brain/client"

export type OverviewItem = { kind: "event" | "task"; id: string; title: string; date?: string; source: CalendarSource }
export type OverviewGroup = {
  /** Undefined for the workspace group. */
  projectId?: string
  /** The Project name; "" for the workspace group, which the UI labels. */
  name: string
  status?: ProjectStatus
  nextMilestone?: string
  notes: NoteSummary[]
  items: OverviewItem[]
}

/**
 * Every Project's notes and upcoming work, one group per Project in the given order, then a workspace group for
 * notes and calendar items that belong to no known Project. `today` is a local `YYYY-MM-DD` key.
 */
export function groupProjectOverview(input: {
  projects: ReadonlyArray<ProjectRecord>
  notes: ReadonlyArray<NoteSummary>
  calendar?: CalendarSnapshot
  today: string
}): OverviewGroup[] {
  const known = new Set(input.projects.map((project) => project.id))
  const owner = (projectId?: string) => (projectId && known.has(projectId) ? projectId : undefined)
  const items = [
    ...(input.calendar?.events ?? [])
      .filter((event) => (event.endDate ?? event.date) >= input.today)
      .map((event) => ({
        projectId: owner(event.projectId),
        item: {
          kind: "event" as const,
          id: `event:${event.id}`,
          title: event.title,
          date: event.date,
          source: event.source,
        },
      })),
    ...(input.calendar?.tasks ?? [])
      .filter((task) => !task.completedAt)
      .map((task) => ({
        projectId: owner(task.projectId),
        item: {
          kind: "task" as const,
          id: `task:${task.id}`,
          title: task.title,
          date: task.scheduledDate ?? task.dueDate,
          source: task.source,
        },
      })),
  ]
  const notes = input.notes.map((note) => ({ note, owners: new Set(note.projectIds.filter((id) => known.has(id))) }))
  const collect = (projectId?: string) => ({
    notes: notes
      .filter((entry) => (projectId ? entry.owners.has(projectId) : entry.owners.size === 0))
      .map((entry) => entry.note)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    items: items
      .filter((entry) => entry.projectId === projectId)
      .map((entry) => entry.item)
      .sort(
        (left, right) => (left.date ?? "￿").localeCompare(right.date ?? "￿") || left.title.localeCompare(right.title),
      ),
  })
  const workspace = collect()
  return [
    ...input.projects.map((project) => ({
      projectId: project.id,
      name: project.name,
      status: project.status,
      ...(project.nextMilestone?.trim() ? { nextMilestone: project.nextMilestone.trim() } : {}),
      ...collect(project.id),
    })),
    ...(workspace.notes.length > 0 || workspace.items.length > 0 ? [{ name: "", ...workspace }] : []),
  ]
}

/**
 * Narrow groups to notes and items whose title contains `query`, ignoring case. A Project whose name matches keeps
 * all its content; a group with no match left is dropped.
 */
export function filterProjectOverview(groups: ReadonlyArray<OverviewGroup>, query: string): OverviewGroup[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...groups]
  const matches = (value: string) => value.toLocaleLowerCase().includes(needle)
  return groups.flatMap((group) => {
    if (group.name && matches(group.name)) return [group]
    const notes = group.notes.filter((note) => matches(note.title))
    const items = group.items.filter((item) => matches(item.title))
    if (notes.length === 0 && items.length === 0) return []
    return [{ ...group, notes, items }]
  })
}
