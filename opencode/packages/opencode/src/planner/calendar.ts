export * as PlannerCalendar from "./calendar"

import { Option, Schema } from "effect"
import { ulid } from "ulid"

const projectPattern = /^project_[0-9A-Z]+$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export const Source = Schema.Literals(["local", "google"])
export type Source = typeof Source.Type

export const SyncState = Schema.Literals(["local", "pending", "synced", "offline", "stale", "conflict", "failed"])
export type SyncState = typeof SyncState.Type

export const Event = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  date: Schema.String,
  endDate: Schema.optional(Schema.String),
  start: Schema.optional(Schema.String),
  end: Schema.optional(Schema.String),
  details: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  calendarId: Schema.optional(Schema.String),
  etag: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
  allDay: Schema.optional(Schema.Boolean),
  recurringSeriesId: Schema.optional(Schema.String),
  participantCount: Schema.optional(Schema.Number),
  outboxKind: Schema.optional(Schema.Literals(["create", "update", "delete"])),
  outboxKey: Schema.optional(Schema.String),
  source: Source,
  syncState: SyncState,
})
export type Event = typeof Event.Type

export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  notes: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  dueDate: Schema.optional(Schema.String),
  scheduledDate: Schema.optional(Schema.String),
  start: Schema.optional(Schema.String),
  end: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  taskListId: Schema.optional(Schema.String),
  taskListTitle: Schema.optional(Schema.String),
  etag: Schema.optional(Schema.String),
  outboxKind: Schema.optional(Schema.Literals(["create", "update", "delete"])),
  outboxKey: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  source: Source,
  syncState: SyncState,
})
export type Task = typeof Task.Type

export const Snapshot = Schema.Struct({
  version: Schema.Literal(2),
  revision: Schema.String,
  events: Schema.Array(Event),
  tasks: Schema.Array(Task),
})
export type Snapshot = typeof Snapshot.Type

export const WriteInput = Schema.Struct({
  expectedRevision: Schema.optional(Schema.String),
  events: Schema.Array(Event),
  tasks: Schema.Array(Task),
})
export type WriteInput = typeof WriteInput.Type

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("PlannerCalendar.InvalidError", {
  reason: Schema.String,
}) {}

export function decode(source: string | undefined): Snapshot {
  if (!source) return { version: 2, revision: "", events: [], tasks: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new InvalidError({ reason: "invalid_json" })
  }
  if (!parsed || typeof parsed !== "object") throw new InvalidError({ reason: "invalid_document" })
  const input = parsed as { version?: unknown; revision?: unknown; events?: unknown; tasks?: unknown }
  const events = Array.isArray(input.events)
    ? input.events.map((event) => migrateEvent(event, input.version === 2))
    : []
  const snapshot = {
    version: 2 as const,
    revision: typeof input.revision === "string" ? input.revision : "",
    events,
    tasks: Array.isArray(input.tasks) ? input.tasks.map(migrateTask) : [],
  }
  const decoded = Schema.decodeUnknownOption(Snapshot)(snapshot)
  if (Option.isNone(decoded)) throw new InvalidError({ reason: "invalid_document" })
  validate(decoded.value.events)
  validateTasks(decoded.value.tasks)
  return decoded.value
}

export function encode(events: ReadonlyArray<Event>, tasks: ReadonlyArray<Task> = []): Snapshot & { source: string } {
  const normalized = normalize(events)
  const snapshot: Snapshot = { version: 2, revision: ulid(), events: normalized, tasks: normalizeTasks(tasks) }
  return { ...snapshot, source: JSON.stringify(snapshot, null, 2) + "\n" }
}

function migrateTask(value: unknown): Task {
  const decoded = Schema.decodeUnknownOption(Task)(value)
  if (Option.isNone(decoded)) throw new InvalidError({ reason: "invalid_task" })
  return decoded.value
}

export function normalize(events: ReadonlyArray<Event>) {
  const normalized = events.map((event) => ({
    ...event,
    title: event.title.trim(),
    ...(event.details?.trim() ? { details: event.details.trim() } : { details: undefined }),
    ...(event.projectId?.trim() ? { projectId: event.projectId.trim() } : { projectId: undefined }),
  }))
  validate(normalized)
  return normalized
}

function migrateEvent(value: unknown, current: boolean): Event {
  if (!value || typeof value !== "object") throw new InvalidError({ reason: "invalid_event" })
  const event = value as Partial<Event>
  const candidate = {
    ...event,
    source: current && event.source ? event.source : "local",
    syncState: current && event.syncState ? event.syncState : "local",
  }
  const decoded = Schema.decodeUnknownOption(Event)(candidate)
  if (Option.isNone(decoded)) throw new InvalidError({ reason: "invalid_event" })
  return decoded.value
}

function validate(events: ReadonlyArray<Event>) {
  if (events.length > 5_000) throw new InvalidError({ reason: "too_many_events" })
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new InvalidError({ reason: "duplicate_id" })
  }
  for (const event of events) {
    if (!event.id || !event.title || [...event.title].length > 300 || !datePattern.test(event.date)) {
      throw new InvalidError({ reason: "invalid_event" })
    }
    if (event.start && !timePattern.test(event.start)) throw new InvalidError({ reason: "invalid_time" })
    if (event.end && !timePattern.test(event.end)) throw new InvalidError({ reason: "invalid_time" })
    if (Boolean(event.start) !== Boolean(event.end)) throw new InvalidError({ reason: "invalid_time_range" })
    if (event.start && event.end && (!event.endDate || event.endDate === event.date) && event.end <= event.start) {
      throw new InvalidError({ reason: "invalid_range" })
    }
    if (event.endDate && !datePattern.test(event.endDate)) throw new InvalidError({ reason: "invalid_end_date" })
    if (event.endDate && event.endDate < event.date) throw new InvalidError({ reason: "invalid_date_range" })
    if (event.details && [...event.details].length > 20_000) throw new InvalidError({ reason: "invalid_details" })
    if (event.projectId && !projectPattern.test(event.projectId)) {
      throw new InvalidError({ reason: "invalid_project" })
    }
    if (event.source === "local" && event.syncState !== "local") {
      throw new InvalidError({ reason: "invalid_sync_state" })
    }
    if (
      event.source === "google" &&
      (!event.providerId ||
        event.calendarId !== "primary" ||
        event.allDay === undefined ||
        !Number.isInteger(event.participantCount) ||
        (event.participantCount ?? -1) < 0 ||
        event.syncState === "local")
    ) {
      throw new InvalidError({ reason: "invalid_provider_event" })
    }
    if (
      Boolean(event.outboxKind) !== Boolean(event.outboxKey) ||
      (event.outboxKey && event.outboxKey.length > 256) ||
      (event.source === "local" && event.outboxKey) ||
      (event.syncState === "synced" && event.outboxKey)
    ) {
      throw new InvalidError({ reason: "invalid_outbox_reference" })
    }
  }
}

function normalizeTasks(tasks: ReadonlyArray<Task>) {
  const normalized = tasks.map((task) => ({
    ...task,
    title: task.title.trim(),
    ...(task.notes?.trim() ? { notes: task.notes.trim() } : { notes: undefined }),
    ...(task.projectId?.trim() ? { projectId: task.projectId.trim() } : { projectId: undefined }),
  }))
  validateTasks(normalized)
  return normalized
}

function validateTasks(tasks: ReadonlyArray<Task>) {
  if (tasks.length > 5_000) throw new InvalidError({ reason: "too_many_tasks" })
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
    throw new InvalidError({ reason: "duplicate_task_id" })
  for (const task of tasks) {
    if (!task.id || !task.title || [...task.title].length > 300) throw new InvalidError({ reason: "invalid_task" })
    if (task.notes && [...task.notes].length > 20_000) throw new InvalidError({ reason: "invalid_task_notes" })
    if (task.projectId && !projectPattern.test(task.projectId))
      throw new InvalidError({ reason: "invalid_task_project" })
    if (task.dueDate && !datePattern.test(task.dueDate)) throw new InvalidError({ reason: "invalid_task_due" })
    if (task.scheduledDate && !datePattern.test(task.scheduledDate)) {
      throw new InvalidError({ reason: "invalid_task_schedule" })
    }
    if (Boolean(task.start) !== Boolean(task.end) || ((task.start || task.end) && !task.scheduledDate)) {
      throw new InvalidError({ reason: "invalid_task_time" })
    }
    if (task.start && !timePattern.test(task.start)) throw new InvalidError({ reason: "invalid_task_time" })
    if (task.end && (!timePattern.test(task.end) || task.end <= task.start!)) {
      throw new InvalidError({ reason: "invalid_task_time" })
    }
    if (task.completedAt && Number.isNaN(Date.parse(task.completedAt))) {
      throw new InvalidError({ reason: "invalid_task_completion" })
    }
    if (Number.isNaN(Date.parse(task.createdAt)) || Number.isNaN(Date.parse(task.updatedAt))) {
      throw new InvalidError({ reason: "invalid_task_timestamp" })
    }
    if (task.source === "local" && task.syncState !== "local") {
      throw new InvalidError({ reason: "invalid_task_sync_state" })
    }
    if (
      task.source === "google" &&
      (!task.providerId || !task.taskListId || !task.taskListTitle || task.syncState === "local")
    ) {
      throw new InvalidError({ reason: "invalid_provider_task" })
    }
    if (
      Boolean(task.outboxKind) !== Boolean(task.outboxKey) ||
      (task.outboxKey && task.outboxKey.length > 256) ||
      (task.source === "local" && (task.providerId || task.taskListId || task.etag || task.outboxKey)) ||
      (task.syncState === "synced" && task.outboxKey)
    ) {
      throw new InvalidError({ reason: "invalid_task_outbox_reference" })
    }
  }
}
