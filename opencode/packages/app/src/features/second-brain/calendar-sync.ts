import { createSignal } from "solid-js"
import type { GoogleCalendarConnection, GoogleCalendarPlatform, GoogleTaskProviderTask } from "@/context/platform"
import { mergeProviderEvents } from "./calendar-domain"
import { readCalendar, writeCalendar, type CalendarSnapshot, type PlannerTask } from "./client"

type Client = Parameters<typeof readCalendar>[0]

// One Google call at a time across the Calendar page and the background sync; the main process
// rejects overlapping calls with `google_operation_busy`.
const [busy, setBusy] = createSignal(false)
// Bumped after each sync writes the calendar, so an open Calendar page reloads it.
const [version, setVersion] = createSignal(0)
const [lastSynced, setLastSynced] = createSignal<number>()
export const calendarSync = { busy, version, lastSynced }

export const providerTask = (task: GoogleTaskProviderTask, local?: PlannerTask): PlannerTask => ({
  id: `google-task:${task.accountId}:${task.taskListId}:${task.providerId}`,
  title: task.title,
  ...(task.notes ? { notes: task.notes } : {}),
  ...(local?.projectId ? { projectId: local.projectId } : {}),
  ...(task.dueDate ? { dueDate: task.dueDate } : {}),
  ...(local?.scheduledDate ? { scheduledDate: local.scheduledDate } : {}),
  ...(local?.start ? { start: local.start, end: local.end } : {}),
  ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  accountId: task.accountId,
  providerId: task.providerId,
  taskListId: task.taskListId,
  taskListTitle: task.taskListTitle,
  ...(task.etag ? { etag: task.etag } : {}),
  createdAt: local?.createdAt ?? task.updatedAt,
  updatedAt: task.updatedAt,
  source: "google",
  syncState: "synced",
})

/**
 * Pulls every connected Google account and merges the result into the folder's calendar.
 * `current` is the calendar the caller shows; when omitted it is read from the server first.
 * Returns undefined when another Google call is already running.
 */
export async function syncGoogleCalendar(input: {
  google: GoogleCalendarPlatform
  client: Client
  current?: CalendarSnapshot
}): Promise<{ saved: CalendarSnapshot; connection: GoogleCalendarConnection } | undefined> {
  if (busy()) return
  setBusy(true)
  try {
    const result = await input.google.sync()
    const current = input.current ?? (await readCalendar(input.client))
    // Items saved before multiple accounts carry no account. They came from the one account then
    // connected, which the desktop migration keeps first in the list.
    const accountOf = (accountId: string | undefined) => accountId ?? result.connection.accounts[0]?.id
    const synced = new Set(result.syncedAccounts)
    const connected = new Set(result.connection.accounts.map((account) => account.id))
    // A connected account that failed this sync keeps its items; disconnected accounts lose theirs.
    const failed = (account: string | undefined) => Boolean(account && connected.has(account) && !synced.has(account))
    const kept = (accountId: string | undefined) => failed(accountOf(accountId))
    const events = mergeProviderEvents(current.events, result.events, {
      accountOf,
      failed,
      synced: (account) => Boolean(account && synced.has(account)),
    })
    const taskKey = (task: { accountId?: string; taskListId?: string; providerId?: string }) =>
      `${accountOf(task.accountId)}:${task.taskListId}:${task.providerId}`
    const localByProvider = new Map(
      current.tasks
        .filter((task) => task.source === "google" && task.providerId && task.taskListId)
        .map((task) => [taskKey(task), task] as const),
    )
    const remoteKeys = new Set(result.tasks.map(taskKey))
    const tasks = [
      ...current.tasks.filter((task) => task.source === "local" || kept(task.accountId)),
      ...current.tasks.filter(
        (task) =>
          task.source === "google" &&
          synced.has(accountOf(task.accountId) ?? "") &&
          Boolean(task.outboxKey) &&
          !remoteKeys.has(taskKey(task)),
      ),
      ...result.tasks.map((task) => providerTask(task, localByProvider.get(taskKey(task)))),
    ]
    const saved = await writeCalendar(input.client, events, current.revision, tasks)
    setLastSynced(Date.now())
    setVersion((value) => value + 1)
    return { saved, connection: result.connection }
  } finally {
    setBusy(false)
  }
}
