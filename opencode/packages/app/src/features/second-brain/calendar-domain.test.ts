import { expect, test } from "bun:test"
import type { CalendarEvent } from "./client"
import {
  dateKeys,
  eventCoversDay,
  eventLastDay,
  localDateKey,
  mergeProviderEvents,
  monthGrid,
  shiftDate,
  shiftMonth,
  weekRange,
} from "./calendar-domain"

const remote = (providerId: string, title = providerId, date = "2026-08-25") => ({
  providerId,
  calendarId: "primary",
  title,
  date,
  allDay: true,
  participantCount: 0,
})

const google = (providerId: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `google:primary:${providerId}`,
  title: providerId,
  date: "2026-08-25",
  providerId,
  calendarId: "primary",
  allDay: true,
  participantCount: 0,
  source: "google",
  syncState: "synced",
  ...extra,
})

test("a timed event ending at midnight does not cover the next day", () => {
  const overnight = { date: "2026-08-25", endDate: "2026-08-26", start: "22:00", end: "00:00" }
  expect(eventLastDay(overnight)).toBe("2026-08-25")
  expect(eventCoversDay(overnight, "2026-08-25")).toBe(true)
  expect(eventCoversDay(overnight, "2026-08-26")).toBe(false)
  const late = { ...overnight, end: "01:00" }
  expect(eventCoversDay(late, "2026-08-26")).toBe(true)
  // All-day events keep their inclusive end date.
  expect(eventCoversDay({ date: "2026-08-25", endDate: "2026-08-27" }, "2026-08-27")).toBe(true)
  expect(dateKeys("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"])
})

test("a Google sync keeps unsynced Google writes and Project links", () => {
  const local: CalendarEvent = { id: "l1", title: "Local", date: "2026-08-25", source: "local", syncState: "local" }
  const current = [
    local,
    // Queued create that Google does not return yet.
    google("queued", { syncState: "offline", outboxKind: "create", outboxKey: "k1" }),
    // Failed update: Google still has the old copy.
    google("failed", { title: "Mine", syncState: "failed", outboxKind: "update", outboxKey: "k2" }),
    google("linked", { projectId: "project_01A" }),
    google("gone"),
  ]
  const merged = mergeProviderEvents(current, [remote("failed", "Theirs"), remote("linked", "Renamed"), remote("new")])
  expect(merged.map((event) => event.id)).toEqual([
    "l1",
    "google:primary:queued",
    "google:primary:failed",
    "google:primary:linked",
    "google:primary:new",
  ])
  expect(merged.find((event) => event.providerId === "failed")?.title).toBe("Mine")
  expect(merged.find((event) => event.providerId === "linked")).toMatchObject({
    title: "Renamed",
    projectId: "project_01A",
  })
  // Duplicate remote ids collapse to one.
  expect(mergeProviderEvents([], [remote("dup"), remote("dup")])).toHaveLength(1)
})

test("a Google sync keeps the remote events nearest to today within the limit", () => {
  const local = Array.from(
    { length: 4_999 },
    (_, index): CalendarEvent => ({
      id: `l${index}`,
      title: "x",
      date: "2026-01-01",
      source: "local",
      syncState: "local",
    }),
  )
  const merged = mergeProviderEvents(
    local,
    [remote("far", "far", "2030-01-01"), remote("near", "near", "2026-08-26")],
    "2026-08-25",
  )
  expect(merged).toHaveLength(5_000)
  expect(merged.at(-1)?.providerId).toBe("near")
})

test("builds a stable six-week local calendar grid", () => {
  const days = monthGrid(new Date(2026, 4, 1, 12), new Date(2026, 4, 18, 12))

  expect(days).toHaveLength(42)
  expect(days[0]).toMatchObject({ date: "2026-04-26", inMonth: false })
  expect(days[22]).toMatchObject({ date: "2026-05-18", inMonth: true, today: true })
  expect(days[41]).toMatchObject({ date: "2026-06-06", inMonth: false })
  expect(localDateKey(shiftMonth(new Date(2026, 11, 1, 12), 1))).toBe("2027-01-01")
  expect(localDateKey(shiftDate(new Date(2026, 11, 31, 12), 1))).toBe("2027-01-01")
  expect(weekRange(new Date(2026, 7, 25, 12))).toEqual({ start: "2026-08-23", end: "2026-08-29" })
})
