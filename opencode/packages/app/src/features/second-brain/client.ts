import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export type NoteSummary = {
  path: string
  title: string
  projectIds: ReadonlyArray<string>
  tags: ReadonlyArray<string>
  links: ReadonlyArray<string>
  updatedAt: string
}
export type NoteDocument = {
  info: NoteSummary
  body: string
  revision: string
}
export type CalendarSource = "local" | "google"
export type CalendarSyncState = "local" | "pending" | "synced" | "offline" | "stale" | "conflict" | "failed"
export type CalendarEvent = {
  id: string
  title: string
  date: string
  endDate?: string
  start?: string
  end?: string
  details?: string
  projectId?: string
  providerId?: string
  calendarId?: string
  etag?: string
  timezone?: string
  allDay?: boolean
  recurringSeriesId?: string
  participantCount?: number
  outboxKind?: "create" | "update" | "delete"
  outboxKey?: string
  source: CalendarSource
  syncState: CalendarSyncState
}
export type PlannerTask = {
  id: string
  title: string
  notes?: string
  projectId?: string
  dueDate?: string
  scheduledDate?: string
  start?: string
  end?: string
  completedAt?: string
  providerId?: string
  taskListId?: string
  taskListTitle?: string
  etag?: string
  outboxKind?: "create" | "update" | "delete"
  outboxKey?: string
  createdAt: string
  updatedAt: string
  source: CalendarSource
  syncState: CalendarSyncState
}
export type CalendarSnapshot = {
  version: 2
  revision: string
  events: ReadonlyArray<CalendarEvent>
  tasks: ReadonlyArray<PlannerTask>
}
export type ProjectStatus = "active" | "paused" | "archived"
export type ProjectRecord = {
  id: string
  folder: string
  name: string
  outcome: string
  templateId?: string | null
  instructions: string
  status: ProjectStatus
  progressPercent: number
  nextMilestone?: string | null
  blocker?: string | null
  tags: ReadonlyArray<string>
  location?: { workspaceId: string; displayPath: string } | null
  createdAt: string
  updatedAt: string
}
export type ProjectCreate = {
  name: string
  outcome: string
  instructions?: string
  tags?: ReadonlyArray<string>
  location?: ProjectRecord["location"]
}
export type ProjectUpdate = Partial<
  Pick<
    ProjectRecord,
    | "name"
    | "outcome"
    | "templateId"
    | "instructions"
    | "status"
    | "progressPercent"
    | "nextMilestone"
    | "blocker"
    | "tags"
    | "location"
  >
> & { expectedUpdatedAt?: string }

type Target = { directory?: string; workspace?: string }
type Client = {
  server: ServerConnection.Any
  fetch?: typeof globalThis.fetch
  target: Target
}

export class SecondBrainRequestError extends Error {
  constructor(readonly status: number) {
    super(`Second Brain request failed with status ${status}`)
    this.name = "SecondBrainRequestError"
  }
}

async function request<T>(client: Client, path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, client.server.http.url)
  if (client.target.workspace) url.searchParams.set("workspace", client.target.workspace)
  else if (client.target.directory) url.searchParams.set("directory", client.target.directory)
  const auth = client.server.http.password
    ? `Basic ${authTokenFromCredentials({
        username: client.server.http.username,
        password: client.server.http.password,
      })}`
    : undefined
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")
  if (init?.body) headers.set("Content-Type", "application/json")
  if (auth) headers.set("Authorization", auth)
  const response = await (client.fetch ?? globalThis.fetch)(url, {
    ...init,
    headers,
  })
  if (!response.ok) throw new SecondBrainRequestError(response.status)
  return (await response.json()) as T
}

export const listNotes = (client: Client) => request<NoteSummary[]>(client, "/second-brain/notes")

export const readNote = (client: Client, path: string) =>
  request<NoteDocument>(client, `/second-brain/note?path=${encodeURIComponent(path)}`)

export const writeNote = (
  client: Client,
  input: {
    path: string
    body: string
    expectedRevision?: string
    title?: string
    projectIds?: ReadonlyArray<string>
    tags?: ReadonlyArray<string>
    create?: boolean
  },
) =>
  request<NoteDocument>(client, `/second-brain/note?path=${encodeURIComponent(input.path)}`, {
    method: "PUT",
    body: JSON.stringify({
      body: input.body,
      expectedRevision: input.expectedRevision,
      title: input.title,
      projectIds: input.projectIds,
      tags: input.tags,
      create: input.create,
    }),
  })

export const readCalendar = (client: Client) => request<CalendarSnapshot>(client, "/second-brain/calendar")

export const writeCalendar = (
  client: Client,
  events: ReadonlyArray<CalendarEvent>,
  expectedRevision?: string,
  tasks: ReadonlyArray<PlannerTask> = [],
) =>
  request<CalendarSnapshot>(client, "/second-brain/calendar", {
    method: "PUT",
    body: JSON.stringify({ events, tasks, expectedRevision }),
  })

export const listProjects = (client: Client) => request<ProjectRecord[]>(client, "/second-brain/projects")

export const readProject = (client: Client, id: string) =>
  request<ProjectRecord>(client, `/second-brain/project?id=${encodeURIComponent(id)}`)

export const createProject = (client: Client, input: ProjectCreate) =>
  request<ProjectRecord>(client, "/second-brain/projects", { method: "POST", body: JSON.stringify(input) })

export const updateProject = (client: Client, id: string, input: ProjectUpdate) =>
  request<ProjectRecord>(client, `/second-brain/project?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
