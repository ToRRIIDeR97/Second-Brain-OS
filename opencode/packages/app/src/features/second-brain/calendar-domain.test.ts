import { expect, test } from "bun:test"
import { localDateKey, monthGrid, shiftDate, shiftMonth, weekRange } from "./calendar-domain"

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
