export type CalendarDay = { date: string; day: number; inMonth: boolean; today: boolean }

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
