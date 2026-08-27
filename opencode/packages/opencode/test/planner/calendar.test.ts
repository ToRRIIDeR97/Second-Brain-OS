import { describe, expect, test } from "bun:test"
import { PlannerCalendar } from "../../src/planner/calendar"

describe("PlannerCalendar", () => {
  test("migrates v1 local events and preserves Project identity", () => {
    const migrated = PlannerCalendar.decode(
      JSON.stringify({ version: 1, events: [{ id: "event_1", title: "Plan", date: "2026-08-25" }] }),
    )
    expect(migrated.events[0]).toMatchObject({ source: "local", syncState: "local" })

    const saved = PlannerCalendar.encode([
      { ...migrated.events[0]!, projectId: "project_01K4B", source: "local", syncState: "local" },
    ])
    expect(PlannerCalendar.decode(saved.source).events[0]?.projectId).toBe("project_01K4B")
    expect(saved.revision).not.toBe("")

    const queued = PlannerCalendar.encode([
      {
        id: "google:primary:event-1",
        title: "Remote review",
        date: "2026-08-25",
        providerId: "event-1",
        calendarId: "primary",
        allDay: true,
        participantCount: 0,
        source: "google",
        syncState: "offline",
        outboxKind: "create",
        outboxKey: "write-1",
      },
    ])
    expect(PlannerCalendar.decode(queued.source).events[0]).toMatchObject({
      source: "google",
      syncState: "offline",
      outboxKind: "create",
    })
  })

  test("keeps task identity when scheduling and unscheduling", () => {
    const task = {
      id: "task_1",
      title: "Write outline",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      source: "local" as const,
      syncState: "local" as const,
    }
    const scheduled = PlannerCalendar.decode(
      PlannerCalendar.encode([], [{ ...task, scheduledDate: "2026-08-26", start: "09:00", end: "10:00" }]).source,
    ).tasks[0]!
    const unscheduled = PlannerCalendar.decode(
      PlannerCalendar.encode([], [{ ...scheduled, scheduledDate: undefined, start: undefined, end: undefined }]).source,
    ).tasks[0]!

    expect(scheduled.id).toBe(task.id)
    expect(unscheduled.id).toBe(task.id)
    expect(unscheduled.scheduledDate).toBeUndefined()
  })

  test("preserves Google task identity and local scheduling enrichment", () => {
    const saved = PlannerCalendar.encode(
      [],
      [
        {
          id: "google-task:list-1:task-1",
          title: "Review draft",
          projectId: "project_01K4B",
          dueDate: "2026-08-27",
          scheduledDate: "2026-08-26",
          providerId: "task-1",
          taskListId: "list-1",
          taskListTitle: "Work",
          etag: "etag-1",
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T01:00:00.000Z",
          source: "google",
          syncState: "synced",
        },
      ],
    )

    expect(PlannerCalendar.decode(saved.source).tasks[0]).toMatchObject({
      providerId: "task-1",
      taskListId: "list-1",
      scheduledDate: "2026-08-26",
      projectId: "project_01K4B",
    })
  })

  test("rejects event end dates before their start date", () => {
    expect(() =>
      PlannerCalendar.encode([
        {
          id: "event_1",
          title: "Invalid range",
          date: "2026-08-26",
          endDate: "2026-08-25",
          source: "local",
          syncState: "local",
        },
      ]),
    ).toThrow()
  })

  test("accepts an overnight timed event", () => {
    const saved = PlannerCalendar.encode([
      {
        id: "event_overnight",
        title: "Night shift",
        date: "2026-08-25",
        endDate: "2026-08-26",
        start: "23:00",
        end: "01:00",
        source: "local",
        syncState: "local",
      },
    ])

    expect(PlannerCalendar.decode(saved.source).events[0]?.endDate).toBe("2026-08-26")
  })
})
