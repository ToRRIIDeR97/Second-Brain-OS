import type { GoogleCalendarProviderEvent } from "@/context/platform"
import type { CalendarEvent } from "./client"

export type CalendarDay = { date: string; day: number; inMonth: boolean; today: boolean }

/** The planner holds at most this many events (the server rejects more). */
export const CALENDAR_EVENT_LIMIT = 5_000

type EventSpan = Pick<CalendarEvent, "date" | "endDate" | "start" | "end">

/**
 * The last day an event occupies. A timed event that ends exactly at midnight on a later day
 * ends before that day starts, so it does not show there.
 */
export function eventLastDay(event: EventSpan) {
  const last = event.endDate ?? event.date
  if (last > event.date && event.start && event.end === "00:00") return shiftDateKey(last, -1)
  return last
}

export function eventCoversDay(event: EventSpan, date: string) {
  return event.date <= date && eventLastDay(event) >= date
}

/** Every day key from `start` to `end`, inclusive. */
export function dateKeys(start: string, end: string) {
  const keys: string[] = []
  for (let key = start; key <= end && keys.length < 1_000; key = shiftDateKey(key, 1)) keys.push(key)
  return keys
}

function shiftDateKey(key: string, amount: number) {
  const [year, month, day] = key.split("-").map(Number)
  return localDateKey(new Date(year, month - 1, day + amount, 12))
}

export function providerEvent(event: GoogleCalendarProviderEvent, projectId?: string): CalendarEvent {
  return {
    id: `google:${event.calendarId}:${event.providerId}`,
    title: event.title,
    date: event.date,
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.start ? { start: event.start } : {}),
    ...(event.end ? { end: event.end } : {}),
    ...(event.details ? { details: event.details } : {}),
    ...(projectId ? { projectId } : {}),
    providerId: event.providerId,
    calendarId: event.calendarId,
    ...(event.etag ? { etag: event.etag } : {}),
    ...(event.timezone ? { timezone: event.timezone } : {}),
    allDay: event.allDay,
    ...(event.recurringSeriesId ? { recurringSeriesId: event.recurringSeriesId } : {}),
    participantCount: event.participantCount,
    source: "google",
    syncState: "synced",
  }
}

/**
 * Merge a Google sync into the local calendar. Local events stay. A Google event with an
 * unsynced write (queued, failed or in conflict) stays as it is, whether or not Google returned
 * it, so a sync never silently drops or overwrites the user's change. Every other Google event
 * is replaced by Google's copy, keeping its Project link. Ids stay unique, and remote events
 * farthest from `today` are dropped if the calendar would exceed its limit.
 */
export function mergeProviderEvents(
  current: ReadonlyArray<CalendarEvent>,
  remote: ReadonlyArray<GoogleCalendarProviderEvent>,
  today = localDateKey(new Date()),
) {
  const projectByProvider = new Map(
    current.flatMap((event) =>
      event.source === "google" && event.providerId && event.projectId ? [[event.providerId, event.projectId]] : [],
    ),
  )
  const unsynced = new Map(
    current.flatMap((event) =>
      event.source === "google" && event.outboxKey && event.syncState !== "synced" ? [[event.id, event]] : [],
    ),
  )
  const kept = [...current.filter((event) => event.source === "local"), ...unsynced.values()]
  const keptIds = new Set(kept.map((event) => event.id))
  const fresh = remote
    .map((event) => providerEvent(event, projectByProvider.get(event.providerId)))
    .filter((event) => {
      if (keptIds.has(event.id)) return false
      keptIds.add(event.id)
      return true
    })
  const room = Math.max(0, CALENDAR_EVENT_LIMIT - kept.length)
  const origin = Date.parse(`${today}T00:00:00Z`)
  const distance = (event: CalendarEvent) => Math.abs(Date.parse(`${event.date}T00:00:00Z`) - origin)
  const allowed =
    fresh.length <= room ? fresh : fresh.toSorted((left, right) => distance(left) - distance(right)).slice(0, room)
  return [...kept, ...allowed]
}

export function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function monthGrid(cursor: Date, now = new Date()): CalendarDay[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  const today = localDateKey(now)
  return Array.from({ length: 42 }, (_, index) => {
    const value = new Date(start)
    value.setDate(start.getDate() + index)
    const date = localDateKey(value)
    return {
      date,
      day: value.getDate(),
      inMonth: value.getMonth() === cursor.getMonth(),
      today: date === today,
    }
  })
}

export function shiftMonth(cursor: Date, amount: number) {
  return new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1, 12)
}

export function shiftDate(cursor: Date, amount: number) {
  const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 12)
  next.setDate(next.getDate() + amount)
  return next
}

export function weekRange(cursor: Date) {
  const start = shiftDate(cursor, -cursor.getDay())
  return { start: localDateKey(start), end: localDateKey(shiftDate(start, 6)) }
}
