import { describe, expect, test } from "bun:test"
import {
  googleEventId,
  googleEventPayload,
  googleScopes,
  googleTaskPayload,
  normalizeGoogleEvent,
  normalizeGoogleTask,
  pkceChallenge,
  requireWritableGoogleEvent,
} from "./google-calendar-domain"

describe("Google Calendar domain", () => {
  test("uses PKCE, narrow scopes, stable IDs, and normalized event fields", () => {
    expect(pkceChallenge("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHijklmno")).toHaveLength(43)
    expect(googleScopes("read")).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/tasks.readonly",
    ])
    expect(googleScopes("write")).toHaveLength(3)
    expect(googleEventId("same-write")).toBe(googleEventId("same-write"))

    const event = normalizeGoogleEvent({
      id: "provider-1",
      summary: "Review",
      etag: "etag-1",
      start: { dateTime: "2026-08-25T09:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-08-25T10:00:00+08:00", timeZone: "Asia/Singapore" },
    })!
    expect(event).toMatchObject({ date: "2026-08-25", start: "09:00", end: "10:00", allDay: false })
    expect(googleEventPayload(event)).toMatchObject({ start: { timeZone: "Asia/Singapore" } })
  })

  test("normalizes Google Tasks while keeping due dates date-only", () => {
    const task = normalizeGoogleTask(
      {
        id: "task-1",
        title: "Write summary",
        notes: "Keep this short",
        due: "2026-08-29T00:00:00.000Z",
        completed: "2026-08-28T04:00:00.000Z",
        status: "completed",
        updated: "2026-08-28T04:00:01.000Z",
        etag: "etag-task-1",
      },
      { id: "list-1", title: "Work" },
    )!

    expect(task).toMatchObject({ taskListId: "list-1", dueDate: "2026-08-29", completedAt: expect.any(String) })
    expect(googleTaskPayload(task)).toMatchObject({
      due: "2026-08-29T00:00:00.000Z",
      status: "completed",
    })
  })

  test("uses inclusive dates locally and Google's exclusive all-day boundary", () => {
    const event = normalizeGoogleEvent({
      id: "provider-2",
      summary: "Conference",
      start: { date: "2026-08-25" },
      end: { date: "2026-08-28" },
    })!

    expect(event).toMatchObject({ date: "2026-08-25", endDate: "2026-08-27", allDay: true })
    expect(googleEventPayload(event)).toMatchObject({
      start: { date: "2026-08-25" },
      end: { date: "2026-08-28" },
    })
  })

  test("preserves the end date of an overnight timed event", () => {
    const event = normalizeGoogleEvent({
      id: "provider-3",
      start: { dateTime: "2026-08-25T23:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-08-26T01:00:00+08:00", timeZone: "Asia/Singapore" },
    })!

    expect(event.endDate).toBe("2026-08-26")
    expect(googleEventPayload(event)).toMatchObject({ end: { dateTime: "2026-08-26T01:00:00" } })
  })

  test("requires authoritative provider metadata before participant-facing writes", () => {
    expect(() =>
      requireWritableGoogleEvent({
        id: "provider-4",
        attendees: [{ email: "guest@example.com" }],
        start: { date: "2026-09-07" },
        end: { date: "2026-09-08" },
      }),
    ).toThrow("google_write_requires_approval")
  })
})
