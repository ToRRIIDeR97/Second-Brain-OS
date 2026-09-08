import { createHash } from "node:crypto"
import type { GoogleCalendarProviderEvent, GoogleTaskProviderTask } from "@opencode-ai/app"

export type GoogleEventResponse = {
  id?: string
  summary?: string
  description?: string
  status?: string
  etag?: string
  recurringEventId?: string
  attendees?: unknown[]
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
}

export type GoogleTaskResponse = {
  id?: string
  title?: string
  notes?: string
  due?: string
  completed?: string
  status?: string
  deleted?: boolean
  updated?: string
  etag?: string
}

export function googleScopes(access: "read" | "write") {
  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    access === "write" ? "https://www.googleapis.com/auth/tasks" : "https://www.googleapis.com/auth/tasks.readonly",
  ]
  if (access === "write") scopes.splice(1, 0, "https://www.googleapis.com/auth/calendar.events")
  return scopes
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function googleEventId(idempotencyKey: string) {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)
}

export function retainGoogleOutbox<T extends { state: string }>(entries: T[]) {
  const unfinished = entries.filter((entry) => entry.state !== "succeeded").length
  if (unfinished > 100) throw new Error("google_outbox_full")
  const completed = entries.filter((entry) => entry.state === "succeeded")
  const retained = new Set(completed.slice(Math.max(0, completed.length - (100 - unfinished))))
  return entries.filter((entry) => entry.state !== "succeeded" || retained.has(entry))
}

export function normalizeGoogleEvent(input: GoogleEventResponse): GoogleCalendarProviderEvent | undefined {
  if (!input.id || input.status === "cancelled" || !input.start || !input.end) return
  const allDay = typeof input.start.date === "string"
  const start = input.start.dateTime
  const end = input.end.dateTime
  const date = allDay ? input.start.date : start?.slice(0, 10)
  if (!date) return
  const endDate = allDay && input.end.date ? previousDate(input.end.date) : end?.slice(0, 10)
  return {
    providerId: input.id,
    calendarId: "primary",
    title: input.summary?.trim() || "Untitled event",
    date,
    ...(endDate && endDate !== date ? { endDate } : {}),
    ...(start ? { start: start.slice(11, 16) } : {}),
    ...(end ? { end: end.slice(11, 16) } : {}),
    ...(input.description ? { details: input.description } : {}),
    ...(input.start.timeZone || input.end.timeZone ? { timezone: input.start.timeZone ?? input.end.timeZone } : {}),
    allDay,
    ...(input.recurringEventId ? { recurringSeriesId: input.recurringEventId } : {}),
    participantCount: input.attendees?.length ?? 0,
    ...(input.etag ? { etag: input.etag } : {}),
  }
}

export function googleEventPayload(event: GoogleCalendarProviderEvent) {
  if (event.recurringSeriesId || event.participantCount > 0) throw new Error("google_write_requires_approval")
  if (event.allDay) {
    return {
      summary: event.title,
      description: event.details,
      start: { date: event.date },
      end: { date: nextDate(event.endDate ?? event.date) },
    }
  }
  if (!event.start || !event.end || !event.timezone) throw new Error("google_time_required")
  return {
    summary: event.title,
    description: event.details,
    start: { dateTime: `${event.date}T${event.start}:00`, timeZone: event.timezone },
    end: { dateTime: `${event.endDate ?? event.date}T${event.end}:00`, timeZone: event.timezone },
  }
}

export function requireWritableGoogleEvent(input: GoogleEventResponse) {
  const event = normalizeGoogleEvent(input)
  if (!event) throw new Error("google_event_invalid_response")
  googleEventPayload(event)
  return event
}

export function normalizeGoogleTask(
  input: GoogleTaskResponse,
  taskList: { id: string; title: string },
): GoogleTaskProviderTask | undefined {
  if (!input.id || input.deleted || !input.updated) return
  return {
    providerId: input.id,
    taskListId: taskList.id,
    taskListTitle: taskList.title.trim() || "Google Tasks",
    title: input.title?.trim() || "Untitled task",
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.due ? { dueDate: input.due.slice(0, 10) } : {}),
    ...(input.status === "completed" && input.completed ? { completedAt: input.completed } : {}),
    updatedAt: input.updated,
    ...(input.etag ? { etag: input.etag } : {}),
  }
}

export function googleTaskPayload(task: GoogleTaskProviderTask) {
  if (!task.title.trim() || task.title.length > 300 || (task.notes?.length ?? 0) > 8_192) {
    throw new Error("google_task_invalid")
  }
  return {
    title: task.title.trim(),
    notes: task.notes?.trim() || null,
    due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
    status: task.completedAt ? "completed" : "needsAction",
    completed: task.completedAt ?? null,
  }
}

function nextDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error("google_date_invalid")
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error("google_date_invalid")
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
