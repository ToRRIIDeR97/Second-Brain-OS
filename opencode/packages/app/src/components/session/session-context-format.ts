import { DateTime } from "luxon"

export function createSessionContextFormatter(locale: string) {
  return {
    number(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale) + "%"
    },
    time(value: number | string | undefined) {
      if (!value) return "—"
      const time = typeof value === "number" ? DateTime.fromMillis(value) : DateTime.fromISO(value)
      return time.setLocale(locale).toLocaleString(DateTime.DATETIME_MED)
    },
  }
}
