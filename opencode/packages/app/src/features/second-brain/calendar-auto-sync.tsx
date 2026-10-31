import { createEffect, onCleanup } from "solid-js"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { calendarSync, syncGoogleCalendar } from "./calendar-sync"

// A focus sync waits until the last one is this old, so switching windows doesn't call Google each time.
const FOCUS_MIN_AGE = 2 * 60_000
// After failures the interval doubles, up to this many times the configured one.
const MAX_BACKOFF = 4

/** Syncs Google Calendar in the background per Settings › Calendar, whatever page is open. Renders nothing. */
export function CalendarAutoSync() {
  const platform = usePlatform()
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  let backoff = 1

  const run = async () => {
    const google = platform.googleCalendar
    const directory = layout.home.workspace()
    if (!google || !directory || calendarSync.busy() || !navigator.onLine) return
    const status = await google.status().catch(() => undefined)
    // Nothing to pull, or Google asked the user to sign in again: wait for the Calendar page.
    if (!status?.connected || status.accounts.every((account) => account.errorCode === "google_reconnect_required"))
      return
    const client = { server: serverSDK().server, fetch: platform.fetch, target: { directory } }
    const done = await syncGoogleCalendar({ google, client }).then(
      () => true,
      () => false,
    )
    backoff = done ? 1 : Math.min(backoff * 2, MAX_BACKOFF)
  }

  createEffect(() => {
    const config = settings.calendar.sync()
    if (!config.autoSync || !platform.googleCalendar || !layout.home.workspace()) return
    // A short delay keeps the first sync out of the way of startup work.
    const first = config.onOpen ? setTimeout(() => void run(), 5_000) : undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      timer = setTimeout(() => void run().finally(schedule), config.intervalMinutes * 60_000 * backoff)
    }
    schedule()
    const focus = () => {
      const last = calendarSync.lastSynced()
      if (config.onFocus && (!last || Date.now() - last > FOCUS_MIN_AGE)) void run()
    }
    window.addEventListener("focus", focus)
    onCleanup(() => {
      clearTimeout(first)
      clearTimeout(timer)
      window.removeEventListener("focus", focus)
    })
  })

  return null
}
