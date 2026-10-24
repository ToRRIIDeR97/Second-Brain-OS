import { useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createEffect, createMemo, createResource, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageFrame, PageHeader, pageRowClass } from "@/components/page"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import {
  usePlatform,
  type GoogleCalendarConnection,
  type GoogleCalendarProviderEvent,
  type GoogleTaskProviderTask,
} from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { localDateKey, monthGrid, shiftDate, shiftMonth, weekRange } from "@/features/second-brain/calendar-domain"
import { CalendarTasks, type CalendarTaskFilter } from "@/features/second-brain/calendar-tasks"
import {
  listProjects,
  readCalendar,
  SecondBrainRequestError,
  writeCalendar,
  type CalendarEvent,
  type PlannerTask,
  type ProjectRecord,
} from "@/features/second-brain/client"

type CalendarView = "today" | "week" | "month" | "agenda" | "tasks" | "upcoming" | "unscheduled" | "completed"
type ScheduleItem =
  | { kind: "event"; date: string; title: string; projectId?: string; event: CalendarEvent }
  | { kind: "task"; date: string; title: string; projectId?: string; task: PlannerTask }

type CalendarDraft = {
  id: string
  title: string
  date: string
  endDate: string
  start: string
  end: string
  details: string
  projectId: string
  source: CalendarEvent["source"]
  syncState: CalendarEvent["syncState"]
  providerId: string
  calendarId: string
  etag: string
  timezone: string
  allDay: boolean
  recurringSeriesId: string
  participantCount: number
  outboxKind: "" | "create" | "update" | "delete"
  outboxKey: string
}

type CalendarState = {
  cursor: Date
  view: CalendarView
  projectFilter: string
  editing: boolean
  selectedTask: string
  draft: CalendarDraft
  saving: boolean
  error: string
  googlePanel: boolean
  googleClientId: string
  googleClientSecret: string
  googleAccess: "read" | "write"
  googleBusy: boolean
  googleError: string
  googleConfirm: "" | "save" | "delete"
  googleWriteKey: string
}

const emptyDraft = (date = localDateKey(new Date()), projectId = ""): CalendarDraft => ({
  id: "",
  title: "",
  date,
  endDate: "",
  start: "",
  end: "",
  details: "",
  projectId,
  source: "local" as CalendarEvent["source"],
  syncState: "local" as CalendarEvent["syncState"],
  providerId: "",
  calendarId: "primary",
  etag: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  allDay: true,
  recurringSeriesId: "",
  participantCount: 0,
  outboxKind: "",
  outboxKey: "",
})

const unavailableGoogle: GoogleCalendarConnection = {
  available: false,
  configured: false,
  connected: false,
  access: "read",
  pendingWrites: 0,
  failedWrites: 0,
}

const providerEvent = (event: GoogleCalendarProviderEvent, projectId?: string): CalendarEvent => ({
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
})

const providerTask = (task: GoogleTaskProviderTask, local?: PlannerTask): PlannerTask => ({
  id: `google-task:${task.taskListId}:${task.providerId}`,
  title: task.title,
  ...(task.notes ? { notes: task.notes } : {}),
  ...(local?.projectId ? { projectId: local.projectId } : {}),
  ...(task.dueDate ? { dueDate: task.dueDate } : {}),
  ...(local?.scheduledDate ? { scheduledDate: local.scheduledDate } : {}),
  ...(local?.start ? { start: local.start, end: local.end } : {}),
  ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  providerId: task.providerId,
  taskListId: task.taskListId,
  taskListTitle: task.taskListTitle,
  ...(task.etag ? { etag: task.etag } : {}),
  createdAt: local?.createdAt ?? task.updatedAt,
  updatedAt: task.updatedAt,
  source: "google",
  syncState: "synced",
})

export default function CalendarPage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [search] = useSearchParams<{
    view?: string
    project?: string
    google?: string
    event?: string
    task?: string
  }>()
  const [state, setState] = createStore<CalendarState>({
    cursor: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12),
    view: calendarView(search.view),
    projectFilter: search.project ?? "",
    editing: false,
    selectedTask: search.task ?? "",
    draft: emptyDraft(),
    saving: false,
    error: "",
    googlePanel: search.google === "connect",
    googleClientId: "",
    googleClientSecret: "",
    googleAccess: "read",
    googleBusy: false,
    googleError: "",
    googleConfirm: "",
    googleWriteKey: "",
  })
  const client = (directory: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory },
  })

  // The sidebar workspace switcher owns this choice; the page only follows it.
  const directory = () => layout.home.workspace() ?? ""
  createEffect(
    on(directory, () => setState({ editing: false, selectedTask: "", draft: emptyDraft() }), { defer: true }),
  )

  const [events, eventActions] = createResource(
    () => directory() || undefined,
    (directory) => readCalendar(client(directory)),
  )
  const [brainProjects] = createResource(
    () => directory() || undefined,
    (directory) => listProjects(client(directory)),
  )
  const [googleConnection, googleActions] = createResource(async () =>
    platform.googleCalendar ? platform.googleCalendar.status() : unavailableGoogle,
  )
  const days = createMemo(() => monthGrid(state.cursor))
  const monthTitle = createMemo(() =>
    new Intl.DateTimeFormat(language.locale(), { month: "long", year: "numeric" }).format(state.cursor),
  )
  const range = createMemo(() => weekRange(state.cursor))
  const viewTitle = createMemo(() => {
    if (state.view === "today") {
      return new Intl.DateTimeFormat(language.locale(), { weekday: "long", month: "long", day: "numeric" }).format(
        state.cursor,
      )
    }
    if (state.view === "week") {
      const start = new Date(`${range().start}T12:00:00`)
      const end = new Date(`${range().end}T12:00:00`)
      const format = new Intl.DateTimeFormat(language.locale(), { month: "short", day: "numeric" })
      return `${format.format(start)} – ${format.format(end)}`
    }
    if (state.view === "month") return monthTitle()
    return language.t("secondBrain.calendar.agenda")
  })
  const weekdays = createMemo(() =>
    Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(language.locale(), { weekday: "short" }).format(new Date(2024, 0, 7 + index, 12)),
    ),
  )
  const eventsFor = (date: string) =>
    (events.latest?.events ?? [])
      .filter(
        (event) =>
          event.date <= date &&
          (event.endDate ?? event.date) >= date &&
          (!state.projectFilter || event.projectId === state.projectFilter),
      )
      .sort(
        (left, right) => (left.start ?? "").localeCompare(right.start ?? "") || left.title.localeCompare(right.title),
      )
  const tasksFor = (date: string) =>
    (events.latest?.tasks ?? [])
      .filter((task) => !task.completedAt && task.scheduledDate === date)
      .sort(
        (left, right) => (left.start ?? "").localeCompare(right.start ?? "") || left.title.localeCompare(right.title),
      )
  const sourceLabel = (source: CalendarEvent["source"]) =>
    source === "google"
      ? language.t("secondBrain.calendar.source.google")
      : language.t("secondBrain.calendar.source.local")
  const syncLabel = (syncState: CalendarEvent["syncState"]) => {
    if (syncState === "pending") return language.t("secondBrain.calendar.sync.pending")
    if (syncState === "synced") return language.t("secondBrain.calendar.sync.synced")
    if (syncState === "offline") return language.t("secondBrain.calendar.sync.offline")
    if (syncState === "stale") return language.t("secondBrain.calendar.sync.stale")
    if (syncState === "conflict") return language.t("secondBrain.calendar.sync.conflict")
    if (syncState === "failed") return language.t("secondBrain.calendar.sync.failed")
    return language.t("secondBrain.calendar.sync.local")
  }

  const schedule = createMemo<ScheduleItem[]>(() => {
    const today = localDateKey(state.cursor)
    const bounds =
      state.view === "today"
        ? { start: today, end: today }
        : state.view === "week"
          ? range()
          : { start: "", end: "9999-12-31" }
    const projectMatch = (projectId?: string) => !state.projectFilter || projectId === state.projectFilter
    const providerEvents = (events.latest?.events ?? [])
      .filter(
        (event) =>
          projectMatch(event.projectId) && event.date <= bounds.end && (event.endDate ?? event.date) >= bounds.start,
      )
      .map(
        (event): ScheduleItem => ({
          kind: "event",
          date: event.date < bounds.start ? bounds.start : event.date,
          title: event.title,
          ...(event.projectId ? { projectId: event.projectId } : {}),
          event,
        }),
      )
    const tasks = (events.latest?.tasks ?? [])
      .filter((task) => {
        if (task.completedAt || !projectMatch(task.projectId)) return false
        const date = task.scheduledDate ?? task.dueDate
        if (!date) return false
        if (state.view === "today") return date <= bounds.end
        return date >= bounds.start && date <= bounds.end
      })
      .map(
        (task): ScheduleItem => ({
          kind: "task",
          date: task.scheduledDate ?? task.dueDate!,
          title: task.title,
          ...(task.projectId ? { projectId: task.projectId } : {}),
          task,
        }),
      )
    return [...providerEvents, ...tasks].sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        scheduleTime(left).localeCompare(scheduleTime(right)) ||
        left.title.localeCompare(right.title),
    )
  })
  const taskView = createMemo(() => taskFilter(state.view))

  const shiftCursor = (amount: number) => {
    if (state.view === "month") {
      setState("cursor", shiftMonth(state.cursor, amount))
      return
    }
    setState("cursor", shiftDate(state.cursor, amount * (state.view === "week" ? 7 : 1)))
  }

  const openNew = (date = localDateKey(new Date())) =>
    setState({
      editing: true,
      draft: emptyDraft(date, state.projectFilter),
      error: "",
      googleConfirm: "",
      googleWriteKey: "",
    })
  const openEvent = (event: CalendarEvent) =>
    setState({
      editing: true,
      error: "",
      draft: {
        id: event.id,
        title: event.title,
        date: event.date,
        endDate: event.endDate ?? "",
        start: event.start ?? "",
        end: event.end ?? "",
        details: event.details ?? "",
        projectId: event.projectId ?? "",
        source: event.source,
        syncState: event.syncState,
        providerId: event.providerId ?? "",
        calendarId: event.calendarId ?? "primary",
        etag: event.etag ?? "",
        timezone: event.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        allDay: event.allDay ?? !event.start,
        recurringSeriesId: event.recurringSeriesId ?? "",
        participantCount: event.participantCount ?? 0,
        outboxKind: event.outboxKind ?? "",
        outboxKey: event.outboxKey ?? "",
      },
      googleConfirm: "",
      googleWriteKey: "",
    })

  let openedEvent: string | undefined
  createEffect(
    on(
      () => [search.event, events()] as const,
      ([id, snapshot]) => {
        if (!id) openedEvent = undefined
        const event = snapshot?.events.find((item) => item.id === id)
        if (event && openedEvent !== id) {
          openedEvent = id
          openEvent(event)
        }
      },
    ),
  )

  const openTask = (id: string) => setState({ view: "tasks", selectedTask: id, editing: false })

  const googleMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("secure_storage")) return language.t("secondBrain.calendar.google.error.secureStorage")
    if (message.includes("write_consent")) return language.t("secondBrain.calendar.google.error.writeConsent")
    if (message.includes("conflict")) return language.t("secondBrain.calendar.google.error.conflict")
    if (message.includes("oauth_denied")) return language.t("secondBrain.calendar.google.error.denied")
    return language.t("secondBrain.calendar.google.error.request")
  }

  const connectGoogle = async () => {
    const google = platform.googleCalendar
    if (!google) return
    if (!state.googleClientId.trim() || !state.googleClientSecret.trim()) {
      setState("googleError", language.t("secondBrain.calendar.google.error.credentials"))
      return
    }
    setState({ googleBusy: true, googleError: "" })
    let connected = false
    try {
      const connection = await google.connect({
        clientId: state.googleClientId,
        clientSecret: state.googleClientSecret,
        access: state.googleAccess,
      })
      googleActions.mutate(connection)
      setState({ googleClientSecret: "", googlePanel: false })
      connected = true
    } catch (error) {
      setState("googleError", googleMessage(error))
    } finally {
      setState("googleBusy", false)
    }
    if (connected) await syncGoogle()
  }

  const syncGoogle = async () => {
    const google = platform.googleCalendar
    const target = directory()
    if (!google || !target) return
    setState({ googleBusy: true, googleError: "" })
    try {
      const result = await google.sync()
      // A sidebar workspace switch during the call leaves events.latest pointing at another calendar.
      if (directory() !== target) return
      const current = events.latest?.events ?? []
      const projectByProvider = new Map(
        current
          .filter((event) => event.source === "google" && event.providerId && event.projectId)
          .map((event) => [event.providerId!, event.projectId!]),
      )
      const merged = [
        ...current.filter((event) => event.source === "local"),
        ...result.events.map((event) => providerEvent(event, projectByProvider.get(event.providerId))),
      ]
      const currentTasks = events.latest?.tasks ?? []
      const localByProvider = new Map(
        currentTasks
          .filter((task) => task.source === "google" && task.providerId && task.taskListId)
          .map((task) => [`${task.taskListId}:${task.providerId}`, task] as const),
      )
      const remoteKeys = new Set(result.tasks.map((task) => `${task.taskListId}:${task.providerId}`))
      const mergedTasks = [
        ...currentTasks.filter((task) => task.source === "local"),
        ...currentTasks.filter(
          (task) =>
            task.source === "google" &&
            Boolean(task.outboxKey) &&
            !remoteKeys.has(`${task.taskListId}:${task.providerId}`),
        ),
        ...result.tasks.map((task) => providerTask(task, localByProvider.get(`${task.taskListId}:${task.providerId}`))),
      ]
      const saved = await writeCalendar(client(target), merged, events.latest?.revision, mergedTasks)
      eventActions.mutate(saved)
      googleActions.mutate(result.connection)
    } catch (error) {
      setState("googleError", googleMessage(error))
    } finally {
      setState("googleBusy", false)
    }
  }

  const disconnectGoogle = async () => {
    const google = platform.googleCalendar
    const target = directory()
    if (!google || !target) return
    setState({ googleBusy: true, googleError: "" })
    try {
      const connection = await google.disconnect()
      googleActions.mutate(connection)
      if (directory() !== target) return
      const local = (events.latest?.events ?? []).filter((event) => event.source === "local")
      const localTasks = (events.latest?.tasks ?? []).filter((task) => task.source === "local")
      const saved = await writeCalendar(client(target), local, events.latest?.revision, localTasks)
      eventActions.mutate(saved)
      setState({ googlePanel: false, editing: false })
    } catch (error) {
      setState("googleError", googleMessage(error))
    } finally {
      setState("googleBusy", false)
    }
  }

  const persist = async (next: CalendarEvent[]) => {
    if (!directory()) return
    setState({ saving: true, error: "" })
    try {
      const saved = await writeCalendar(client(directory()), next, events.latest?.revision, events.latest?.tasks)
      eventActions.mutate(saved)
      setState({ editing: false, draft: emptyDraft() })
    } catch (error) {
      setState(
        "error",
        error instanceof SecondBrainRequestError && error.status === 409
          ? language.t("secondBrain.calendar.error.conflict")
          : language.t("secondBrain.error.request"),
      )
    } finally {
      setState("saving", false)
    }
  }

  const persistTasks = async (tasks: ReadonlyArray<PlannerTask>) => {
    if (!directory()) return
    const current = events.latest?.tasks ?? []
    const removed = current.find((task) => task.source === "google" && !tasks.some((next) => next.id === task.id))
    const changed = tasks.find((task) => {
      if (task.source !== "google") return false
      const previous = current.find((item) => item.id === task.id)
      return !previous || googleTaskFields(previous) !== googleTaskFields(task)
    })
    if (removed && changed) throw new Error("google_multiple_task_writes")

    let next = [...tasks]
    const target = removed ?? changed
    if (target) {
      const google = platform.googleCalendar
      if (!google || !googleConnection.latest?.connected || googleConnection.latest?.access !== "write") {
        throw new Error("google_write_consent_required")
      }
      const kind = removed ? "delete" : target.providerId?.startsWith("pending:") ? "create" : "update"
      const idempotencyKey = target.outboxKey || crypto.randomUUID()
      const result = await google.writeTask({
        kind,
        idempotencyKey,
        task: {
          providerId: target.providerId ?? `pending:${target.id}`,
          taskListId: target.taskListId ?? "@default",
          taskListTitle: target.taskListTitle ?? language.t("secondBrain.tasks.google.defaultList"),
          title: target.title,
          ...(target.notes ? { notes: target.notes } : {}),
          ...(target.dueDate ? { dueDate: target.dueDate } : {}),
          ...(target.completedAt ? { completedAt: target.completedAt } : {}),
          updatedAt: target.updatedAt,
          ...(target.etag ? { etag: target.etag } : {}),
        },
      })
      if (kind === "delete") {
        if (result.state !== "synced") {
          next.push({ ...target, syncState: result.state, outboxKind: kind, outboxKey: idempotencyKey })
        }
      } else {
        if (!result.task) throw new Error("google_task_write_failed")
        const savedTask: PlannerTask = {
          ...providerTask(result.task, target),
          syncState: result.state === "synced" ? ("synced" as const) : result.state,
          ...(result.state === "synced" ? {} : { outboxKind: kind, outboxKey: idempotencyKey }),
        }
        next = next.map((task) => (task.id === target.id ? savedTask : task))
      }
      await googleActions.refetch()
    }
    const saved = await writeCalendar(client(directory()), events.latest?.events ?? [], events.latest?.revision, next)
    eventActions.mutate(saved)
  }

  const save = async () => {
    const title = state.draft.title.trim()
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(state.draft.date)) {
      setState("error", language.t("secondBrain.calendar.error.required"))
      return
    }
    if (
      state.draft.endDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(state.draft.endDate) || state.draft.endDate < state.draft.date)
    ) {
      setState("error", language.t("secondBrain.calendar.error.dateRange"))
      return
    }
    if (Boolean(state.draft.start) !== Boolean(state.draft.end)) {
      setState("error", language.t("secondBrain.calendar.error.exactTime"))
      return
    }
    if (
      state.draft.start &&
      state.draft.end &&
      (!state.draft.endDate || state.draft.endDate === state.draft.date) &&
      state.draft.end <= state.draft.start
    ) {
      setState("error", language.t("secondBrain.calendar.error.time"))
      return
    }
    const item: CalendarEvent = {
      id: state.draft.id || crypto.randomUUID(),
      title,
      date: state.draft.date,
      ...(state.draft.endDate ? { endDate: state.draft.endDate } : {}),
      ...(state.draft.start ? { start: state.draft.start } : {}),
      ...(state.draft.end ? { end: state.draft.end } : {}),
      ...(state.draft.details.trim() ? { details: state.draft.details.trim() } : {}),
      ...(state.draft.projectId ? { projectId: state.draft.projectId } : {}),
      source: "local",
      syncState: "local",
    }
    const current = events.latest?.events ?? []
    if (state.draft.source === "google") {
      const original = current.find((event) => event.id === state.draft.id)
      const providerUnchanged =
        original?.title === title &&
        original.date === state.draft.date &&
        (original.endDate ?? "") === state.draft.endDate &&
        (original.start ?? "") === state.draft.start &&
        (original.end ?? "") === state.draft.end &&
        (original.details ?? "") === state.draft.details.trim()
      if (original && providerUnchanged) {
        const { projectId: _projectId, ...providerItem } = original
        const enriched = state.draft.projectId ? { ...providerItem, projectId: state.draft.projectId } : providerItem
        await persist(current.map((event) => (event.id === original.id ? enriched : event)))
        return
      }
      if (
        !platform.googleCalendar ||
        !googleConnection.latest?.connected ||
        googleConnection.latest?.access !== "write"
      ) {
        setState("error", language.t("secondBrain.calendar.google.error.writeConsent"))
        return
      }
      if (Boolean(state.draft.start) !== Boolean(state.draft.end)) {
        setState("error", language.t("secondBrain.calendar.google.error.exactTime"))
        return
      }
      if (state.draft.recurringSeriesId || state.draft.participantCount > 0) {
        setState("error", language.t("secondBrain.calendar.google.error.restricted"))
        return
      }
      setState({
        googleConfirm: "save",
        googleWriteKey: state.draft.outboxKey || state.googleWriteKey || crypto.randomUUID(),
      })
      return
    }
    await persist(
      state.draft.id ? current.map((event) => (event.id === state.draft.id ? item : event)) : [...current, item],
    )
  }

  const remove = async () => {
    if (!state.draft.id) return
    if (state.draft.source === "google") {
      setState({
        googleConfirm: "delete",
        googleWriteKey: state.draft.outboxKey || state.googleWriteKey || crypto.randomUUID(),
      })
      return
    }
    await persist((events.latest?.events ?? []).filter((event) => event.id !== state.draft.id))
  }

  const googleDraft = (): GoogleCalendarProviderEvent => ({
    providerId: state.draft.providerId || "pending",
    calendarId: "primary",
    title: state.draft.title.trim(),
    date: state.draft.date,
    ...(state.draft.endDate ? { endDate: state.draft.endDate } : {}),
    ...(state.draft.start ? { start: state.draft.start } : {}),
    ...(state.draft.end ? { end: state.draft.end } : {}),
    ...(state.draft.details.trim() ? { details: state.draft.details.trim() } : {}),
    timezone: state.draft.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    allDay: !state.draft.start && !state.draft.end,
    ...(state.draft.recurringSeriesId ? { recurringSeriesId: state.draft.recurringSeriesId } : {}),
    participantCount: state.draft.participantCount,
    ...(state.draft.etag ? { etag: state.draft.etag } : {}),
  })

  const confirmGoogleWrite = async () => {
    const google = platform.googleCalendar
    const target = directory()
    if (!google || !target || !state.googleConfirm) return
    setState({ saving: true, error: "" })
    try {
      const deleting = state.googleConfirm === "delete"
      const operationKind = deleting
        ? "delete"
        : state.draft.outboxKind || (state.draft.providerId ? "update" : "create")
      const result = await google.write({
        kind: operationKind,
        idempotencyKey: state.googleWriteKey,
        event: googleDraft(),
      })
      if (directory() !== target) return
      const current = events.latest?.events ?? []
      const next = deleting
        ? result.state === "synced"
          ? current.filter((event) => event.id !== state.draft.id)
          : current.map((event) =>
              event.id === state.draft.id
                ? {
                    ...event,
                    syncState: result.state,
                    outboxKind: operationKind,
                    outboxKey: state.googleWriteKey,
                  }
                : event,
            )
        : (() => {
            if (!result.event) throw new Error("google_write_failed")
            const savedEvent = {
              ...providerEvent(result.event, state.draft.projectId || undefined),
              syncState: result.state === "synced" ? ("synced" as const) : result.state,
              ...(result.state === "synced" ? {} : { outboxKind: operationKind, outboxKey: state.googleWriteKey }),
            }
            return state.draft.id
              ? current.map((event) => (event.id === state.draft.id ? savedEvent : event))
              : [...current, savedEvent]
          })()
      const saved = await writeCalendar(client(target), next, events.latest?.revision, events.latest?.tasks)
      eventActions.mutate(saved)
      setState({ editing: false, draft: emptyDraft(), googleConfirm: "", googleWriteKey: "" })
      await googleActions.refetch()
      if (result.state !== "synced") {
        setState(
          "googleError",
          result.state === "offline"
            ? language.t("secondBrain.calendar.google.writeQueued")
            : result.state === "conflict"
              ? language.t("secondBrain.calendar.google.error.conflict")
              : language.t("secondBrain.calendar.google.writeFailed"),
        )
      }
    } catch (error) {
      setState(
        "error",
        error instanceof SecondBrainRequestError
          ? language.t("secondBrain.calendar.error.conflict")
          : googleMessage(error),
      )
    } finally {
      setState("saving", false)
    }
  }

  const selectView = (view: (typeof calendarNavigation)[number]) =>
    setState({
      view,
      editing: false,
      googlePanel: false,
      selectedTask: "",
      ...(view === "today" ? { cursor: new Date() } : {}),
    })

  return (
    <PageFrame labelledBy="calendar-title" class="flex flex-col">
      <PageHeader
        id="calendar-title"
        title={language.t("secondBrain.calendar.title")}
        actions={
          <Show when={directory()}>
            <Show when={!taskView() && state.view !== "agenda"}>
              <TooltipV2
                value={language.t(
                  state.view === "week"
                    ? "secondBrain.calendar.previousWeek"
                    : state.view === "today"
                      ? "secondBrain.calendar.previousDay"
                      : "secondBrain.calendar.previous",
                )}
              >
                <IconButtonV2
                  type="button"
                  variant="ghost"
                  icon={<Icon name="chevron-left" />}
                  aria-label={language.t(
                    state.view === "week"
                      ? "secondBrain.calendar.previousWeek"
                      : state.view === "today"
                        ? "secondBrain.calendar.previousDay"
                        : "secondBrain.calendar.previous",
                  )}
                  onClick={() => shiftCursor(-1)}
                />
              </TooltipV2>
              <TooltipV2
                value={language.t(
                  state.view === "week"
                    ? "secondBrain.calendar.nextWeek"
                    : state.view === "today"
                      ? "secondBrain.calendar.nextDay"
                      : "secondBrain.calendar.next",
                )}
              >
                <IconButtonV2
                  type="button"
                  variant="ghost"
                  icon={<Icon name="chevron-right" />}
                  aria-label={language.t(
                    state.view === "week"
                      ? "secondBrain.calendar.nextWeek"
                      : state.view === "today"
                        ? "secondBrain.calendar.nextDay"
                        : "secondBrain.calendar.next",
                  )}
                  onClick={() => shiftCursor(1)}
                />
              </TooltipV2>
            </Show>
            <Show when={state.view === "week" || state.view === "month"}>
              <ButtonV2
                size="small"
                variant="outline"
                onClick={() =>
                  setState(
                    "cursor",
                    new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12),
                  )
                }
              >
                {language.t("secondBrain.calendar.today")}
              </ButtonV2>
            </Show>
            <nav aria-label={language.t("secondBrain.calendar.views")}>
              <SegmentedControlV2 class="!w-auto" value={taskView() ? "tasks" : state.view}>
                <For each={calendarNavigation}>
                  {(view) => (
                    <SegmentedControlItemV2 value={view} class="!flex-auto" onClick={() => selectView(view)}>
                      {language.t(`secondBrain.calendar.view.${view}`)}
                    </SegmentedControlItemV2>
                  )}
                </For>
              </SegmentedControlV2>
            </nav>
          </Show>
        }
      />

      <Show when={directory()} fallback={<PageEmpty>{language.t("secondBrain.empty.workspace")}</PageEmpty>}>
        <div class="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-2">
          <h2 class="min-w-0 flex-1 truncate text-[14px] text-v2-text-text-base [font-weight:530]">
            <Show when={!taskView()}>{viewTitle()}</Show>
          </h2>
          <Show when={!taskView()}>
            <SelectV2
              aria-label={language.t("secondBrain.calendar.filterProject")}
              class="!h-8 !w-auto max-w-44"
              options={["__all__", ...(brainProjects.latest ?? []).map((project) => project.id)]}
              current={state.projectFilter || "__all__"}
              label={(projectID) =>
                projectID === "__all__"
                  ? language.t("secondBrain.calendar.allProjects")
                  : (brainProjects.latest?.find((project) => project.id === projectID)?.name ?? projectID)
              }
              onSelect={(projectID) => setState("projectFilter", projectID === "__all__" ? "" : (projectID ?? ""))}
            />
          </Show>
          <Show when={state.googleError}>
            <span role="alert" class="max-w-48 truncate text-[11px] text-v2-text-text-critical">
              {state.googleError}
            </span>
          </Show>
          <ButtonV2
            variant="outline"
            size="small"
            aria-expanded={state.googlePanel}
            onClick={() => setState({ googlePanel: !state.googlePanel, view: "today" })}
          >
            {googleConnection.latest?.connected
              ? language.t("secondBrain.calendar.google.connected")
              : language.t("secondBrain.calendar.google.connect")}
          </ButtonV2>
          <Show when={!taskView()}>
            <ButtonV2 variant="contrast" size="small" icon="plus" onClick={() => openNew()}>
              {language.t("secondBrain.calendar.new")}
            </ButtonV2>
          </Show>
        </div>

        <Show when={taskView()} keyed>
          {(filter) => (
            <CalendarTasks
              tasks={events.latest?.tasks ?? []}
              projects={brainProjects.latest ?? []}
              onSave={persistTasks}
              filter={filter}
              selectedId={state.selectedTask}
              googleCanWrite={googleConnection.latest?.connected && googleConnection.latest?.access === "write"}
              onFilterChange={(next) => setState("view", viewForTaskFilter(next))}
            />
          )}
        </Show>
        <Show when={!taskView()}>
          <div
            classList={{
              "grid min-h-0 flex-1 gap-3 px-3 pb-3": true,
              "lg:grid-cols-[minmax(0,1fr)_320px]": state.googlePanel || state.editing,
            }}
          >
            <div class="flex min-h-[560px] min-w-0 flex-col">
              <Show
                when={!events.loading}
                fallback={
                  <div class="flex flex-1 items-center justify-center text-[13px] text-v2-text-text-faint">
                    {language.t("common.loading")}
                  </div>
                }
              >
                <Show
                  when={state.view === "month"}
                  fallback={
                    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
                      <Show
                        when={schedule().length > 0}
                        fallback={<PageEmpty>{language.t("secondBrain.calendar.empty")}</PageEmpty>}
                      >
                        <For each={schedule()}>
                          {(item) => (
                            <ScheduleRow
                              item={item}
                              today={localDateKey(new Date())}
                              projects={brainProjects.latest ?? []}
                              onOpenEvent={openEvent}
                              onOpenTask={() => openTask(item.kind === "task" ? item.task.id : "")}
                              eventSource={sourceLabel}
                              taskLabel={language.t("secondBrain.home.kind.task")}
                            />
                          )}
                        </For>
                      </Show>
                    </div>
                  }
                >
                  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]">
                    <div class="grid h-8 shrink-0 grid-cols-7 bg-v2-background-bg-layer-01">
                      <For each={weekdays()}>
                        {(weekday) => (
                          <div class="flex items-center justify-center text-[12px] text-v2-text-text-muted [font-weight:530]">
                            {weekday}
                          </div>
                        )}
                      </For>
                    </div>
                    <div class="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
                      <For each={days()}>
                        {(day) => (
                          <div
                            classList={{
                              "group/day flex min-h-0 flex-col items-stretch overflow-hidden border-b border-r border-v2-border-border-muted p-1 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0": true,
                              "bg-v2-background-bg-layer-01": !day.inMonth,
                            }}
                          >
                            <button
                              type="button"
                              classList={{
                                "mx-auto mb-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[12px] transition-colors duration-150 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none": true,
                                "bg-v2-icon-icon-accent text-v2-icon-icon-contrast [font-weight:560]": day.today,
                                "hover:bg-v2-overlay-simple-overlay-hover": !day.today,
                                "text-v2-text-text-faint": !day.inMonth && !day.today,
                                "text-v2-text-text-muted": day.inMonth && !day.today,
                              }}
                              aria-label={`${language.t("secondBrain.calendar.newOn")} ${day.date}`}
                              aria-current={day.today ? "date" : undefined}
                              onClick={() => openNew(day.date)}
                            >
                              {day.day}
                            </button>
                            <div class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                              <For each={eventsFor(day.date)}>
                                {(event) => (
                                  <button
                                    type="button"
                                    class="min-h-6 shrink-0 cursor-pointer truncate rounded-[8px] bg-v2-background-bg-accent-container px-2 text-left text-[11px] text-v2-text-text-on-accent-container transition-[filter,border-radius] duration-300 ease-standard hover:brightness-95 active:rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                                    title={event.title}
                                    onClick={() => openEvent(event)}
                                  >
                                    <Show when={event.start && event.date === day.date}>
                                      <span class="mr-1 opacity-70">{event.start}</span>
                                    </Show>
                                    {event.title}
                                  </button>
                                )}
                              </For>
                              <For each={tasksFor(day.date)}>
                                {(task) => (
                                  <button
                                    type="button"
                                    class="min-h-6 shrink-0 cursor-pointer truncate rounded-[8px] px-2 text-left text-[11px] text-v2-text-text-muted shadow-[inset_0_0_0_1px_var(--v2-border-border-base)] transition-[background-color,border-radius] duration-300 ease-standard hover:bg-v2-overlay-simple-overlay-hover active:rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                                    title={task.title}
                                    onClick={() => openTask(task.id)}
                                  >
                                    <Show when={task.start}>
                                      <span class="mr-1 text-v2-text-text-faint">{task.start}</span>
                                    </Show>
                                    {task.title}
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </Show>
            </div>

            <Show when={state.googlePanel || state.editing}>
              <aside class="flex min-h-0 flex-col overflow-y-auto rounded-[24px] bg-v2-background-bg-layer-01">
                <Show when={state.googlePanel}>
                  <div class="flex flex-col gap-3 p-4">
                    <div class="flex items-start gap-2">
                      <div class="min-w-0 flex-1">
                        <h2 class="text-[14px] text-v2-text-text-base [font-weight:530]">
                          {language.t("secondBrain.calendar.google.title")}
                        </h2>
                        <p class="mt-1 text-[11px] leading-4 text-v2-text-text-faint">
                          {language.t("secondBrain.calendar.google.description")}
                        </p>
                      </div>
                      <TooltipV2 value={language.t("common.close")}>
                        <IconButtonV2
                          type="button"
                          size="small"
                          variant="ghost"
                          icon={<Icon name="close" />}
                          aria-label={language.t("common.close")}
                          onClick={() => setState("googlePanel", false)}
                        />
                      </TooltipV2>
                    </div>
                    <Show
                      when={!googleConnection.loading}
                      fallback={<p class="text-[12px] text-v2-text-text-faint">{language.t("common.loading")}</p>}
                    >
                      <Show
                        when={googleConnection.latest?.available}
                        fallback={
                          <p role="status" class={noteClass}>
                            {platform.platform === "desktop"
                              ? language.t("secondBrain.calendar.google.secureStorageUnavailable")
                              : language.t("secondBrain.calendar.google.desktopRequired")}
                          </p>
                        }
                      >
                        <Show
                          when={googleConnection.latest?.connected}
                          fallback={
                            <form
                              class="flex flex-col gap-3"
                              onSubmit={(event) => {
                                event.preventDefault()
                                void connectGoogle()
                              }}
                            >
                              <label class={fieldClass} for="google-client-id">
                                {language.t("secondBrain.calendar.google.clientId")}
                                <TextInputV2
                                  id="google-client-id"
                                  value={state.googleClientId}
                                  autocomplete="off"
                                  onInput={(event) => setState("googleClientId", event.currentTarget.value)}
                                />
                              </label>
                              <label class={fieldClass} for="google-client-secret">
                                {language.t("secondBrain.calendar.google.clientSecret")}
                                <TextInputV2
                                  id="google-client-secret"
                                  type="password"
                                  value={state.googleClientSecret}
                                  autocomplete="off"
                                  onInput={(event) => setState("googleClientSecret", event.currentTarget.value)}
                                />
                              </label>
                              <label class={fieldClass} for="google-access">
                                {language.t("secondBrain.calendar.google.access")}
                                <SelectV2
                                  id="google-access"
                                  aria-label={language.t("secondBrain.calendar.google.access")}
                                  class="!h-8 !w-full"
                                  options={["read", "write"] as const}
                                  current={state.googleAccess}
                                  label={(access) => language.t(`secondBrain.calendar.google.access.${access}`)}
                                  onSelect={(access) =>
                                    access && setState("googleAccess", access === "write" ? "write" : "read")
                                  }
                                />
                              </label>
                              <p class="text-[11px] leading-4 text-v2-text-text-faint">
                                {language.t("secondBrain.calendar.google.credentialNote")}
                              </p>
                              <Show when={state.googleError}>
                                <p role="alert" class="text-[12px] text-v2-text-text-critical">
                                  {state.googleError}
                                </p>
                              </Show>
                              <ButtonV2 type="submit" variant="contrast" disabled={state.googleBusy}>
                                {state.googleBusy
                                  ? language.t("secondBrain.calendar.google.waiting")
                                  : language.t("secondBrain.calendar.google.openBrowser")}
                              </ButtonV2>
                            </form>
                          }
                        >
                          <div class="flex flex-col gap-3">
                            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
                              <dt class="text-v2-text-text-faint">
                                {language.t("secondBrain.calendar.google.account")}
                              </dt>
                              <dd class="truncate text-v2-text-text-base">
                                {googleConnection.latest?.accountLabel ??
                                  language.t("secondBrain.calendar.google.accountFallback")}
                              </dd>
                              <dt class="text-v2-text-text-faint">
                                {language.t("secondBrain.calendar.google.access")}
                              </dt>
                              <dd class="text-v2-text-text-base">
                                {googleConnection.latest?.access === "write"
                                  ? language.t("secondBrain.calendar.google.access.write")
                                  : language.t("secondBrain.calendar.google.access.read")}
                              </dd>
                              <dt class="text-v2-text-text-faint">
                                {language.t("secondBrain.calendar.google.lastSync")}
                              </dt>
                              <dd class="text-v2-text-text-base">
                                {googleConnection.latest?.lastSyncedAt
                                  ? new Intl.DateTimeFormat(language.locale(), {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    }).format(new Date(googleConnection.latest!.lastSyncedAt!))
                                  : language.t("secondBrain.calendar.google.never")}
                              </dd>
                            </dl>
                            <Show when={(googleConnection.latest?.pendingWrites ?? 0) > 0}>
                              <p role="status" class={noteClass}>
                                {language.t("secondBrain.calendar.google.pendingWrites", {
                                  count: googleConnection.latest?.pendingWrites ?? 0,
                                })}
                              </p>
                            </Show>
                            <Show when={(googleConnection.latest?.failedWrites ?? 0) > 0}>
                              <p role="alert" class={`${noteClass} !text-v2-text-text-critical`}>
                                {language.t("secondBrain.calendar.google.failedWrites", {
                                  count: googleConnection.latest?.failedWrites ?? 0,
                                })}
                              </p>
                            </Show>
                            <Show when={state.googleError}>
                              <p role="alert" class="text-[12px] text-v2-text-text-critical">
                                {state.googleError}
                              </p>
                            </Show>
                            <ButtonV2 variant="contrast" disabled={state.googleBusy} onClick={() => void syncGoogle()}>
                              {state.googleBusy
                                ? language.t("secondBrain.calendar.google.syncing")
                                : language.t("secondBrain.calendar.google.sync")}
                            </ButtonV2>
                            <ButtonV2
                              variant="ghost"
                              disabled={state.googleBusy}
                              onClick={() => void disconnectGoogle()}
                            >
                              {language.t("secondBrain.calendar.google.disconnect")}
                            </ButtonV2>
                          </div>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                </Show>
                <Show when={!state.googlePanel && state.editing}>
                  <form
                    class="flex flex-col gap-3 p-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void save()
                    }}
                  >
                    <div class="flex items-center gap-2">
                      <h2 class="min-w-0 flex-1 text-[14px] text-v2-text-text-base [font-weight:530]">
                        {state.draft.id
                          ? language.t("secondBrain.calendar.edit")
                          : language.t("secondBrain.calendar.new")}
                      </h2>
                      <Show when={state.draft.id}>
                        <span class="rounded-full bg-v2-background-bg-base px-2 py-1 text-[10px] capitalize text-v2-text-text-faint">
                          {sourceLabel(state.draft.source)} · {syncLabel(state.draft.syncState)}
                        </span>
                      </Show>
                      <TooltipV2 value={language.t("common.cancel")}>
                        <IconButtonV2
                          type="button"
                          size="small"
                          variant="ghost"
                          icon={<Icon name="close" />}
                          aria-label={language.t("common.cancel")}
                          onClick={() => setState("editing", false)}
                        />
                      </TooltipV2>
                    </div>
                    <label class={fieldClass} for="calendar-event-title">
                      {language.t("secondBrain.calendar.eventTitle")}
                      <TextInputV2
                        id="calendar-event-title"
                        appearance="large"
                        autofocus
                        value={state.draft.title}
                        onInput={(event) => setState("draft", "title", event.currentTarget.value)}
                      />
                    </label>
                    <Show
                      when={
                        !state.draft.id &&
                        googleConnection.latest?.connected &&
                        googleConnection.latest?.access === "write"
                      }
                    >
                      <label class={fieldClass} for="calendar-event-source">
                        {language.t("secondBrain.calendar.google.destination")}
                        <SelectV2
                          id="calendar-event-source"
                          aria-label={language.t("secondBrain.calendar.google.destination")}
                          class="!h-8 !w-full"
                          options={["local", "google"] as const}
                          current={state.draft.source === "google" ? "google" : "local"}
                          label={(source) =>
                            source === "google"
                              ? language.t("secondBrain.calendar.google.title")
                              : language.t("secondBrain.calendar.sync.local")
                          }
                          onSelect={(source) =>
                            source &&
                            setState("draft", {
                              ...state.draft,
                              source: source === "google" ? "google" : "local",
                              syncState: source === "google" ? "pending" : "local",
                            })
                          }
                        />
                      </label>
                    </Show>
                    <label class={fieldClass} for="calendar-event-project">
                      {language.t("secondBrain.calendar.project")}
                      <SelectV2
                        id="calendar-event-project"
                        aria-label={language.t("secondBrain.calendar.project")}
                        class="!h-8 !w-full"
                        options={["__none__", ...(brainProjects.latest ?? []).map((project) => project.id)]}
                        current={state.draft.projectId || "__none__"}
                        label={(projectID) =>
                          projectID === "__none__"
                            ? language.t("secondBrain.calendar.noProject")
                            : (brainProjects.latest?.find((project) => project.id === projectID)?.name ?? projectID)
                        }
                        onSelect={(projectID) =>
                          setState("draft", "projectId", projectID === "__none__" ? "" : (projectID ?? ""))
                        }
                      />
                    </label>
                    <div class="grid grid-cols-2 gap-3">
                      <label class={fieldClass} for="calendar-event-date">
                        {language.t("secondBrain.calendar.date")}
                        <input
                          id="calendar-event-date"
                          type="date"
                          class={dateInputClass}
                          value={state.draft.date}
                          onInput={(event) => setState("draft", "date", event.currentTarget.value)}
                        />
                      </label>
                      <label class={fieldClass} for="calendar-event-end-date">
                        {language.t("secondBrain.calendar.endDate")}
                        <input
                          id="calendar-event-end-date"
                          type="date"
                          min={state.draft.date}
                          class={dateInputClass}
                          value={state.draft.endDate}
                          onInput={(event) => setState("draft", "endDate", event.currentTarget.value)}
                        />
                      </label>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                      <label class={fieldClass} for="calendar-event-start">
                        {language.t("secondBrain.calendar.start")}
                        <input
                          id="calendar-event-start"
                          type="time"
                          class={dateInputClass}
                          value={state.draft.start}
                          onInput={(event) => setState("draft", "start", event.currentTarget.value)}
                        />
                      </label>
                      <label class={fieldClass} for="calendar-event-end">
                        {language.t("secondBrain.calendar.end")}
                        <input
                          id="calendar-event-end"
                          type="time"
                          class={dateInputClass}
                          value={state.draft.end}
                          onInput={(event) => setState("draft", "end", event.currentTarget.value)}
                        />
                      </label>
                    </div>
                    <Show when={state.draft.source === "google" && (state.draft.start || state.draft.end)}>
                      <p class="-mt-1 text-[11px] leading-4 text-v2-text-text-faint">
                        {language.t("secondBrain.calendar.google.timezone", { timezone: state.draft.timezone })}
                      </p>
                    </Show>
                    <label class={fieldClass} for="calendar-event-details">
                      {language.t("secondBrain.calendar.details")}
                      <TextareaV2
                        id="calendar-event-details"
                        rows={5}
                        value={state.draft.details}
                        onInput={(event) => setState("draft", "details", event.currentTarget.value)}
                      />
                    </label>
                    <Show
                      when={
                        state.draft.source === "google" &&
                        (state.draft.recurringSeriesId || state.draft.participantCount > 0)
                      }
                    >
                      <p role="status" class={noteClass}>
                        {language.t("secondBrain.calendar.google.restricted")}
                      </p>
                    </Show>
                    <Show when={state.googleConfirm}>
                      <div
                        role="group"
                        aria-label={language.t("secondBrain.calendar.google.confirm.title")}
                        class="rounded-[16px] bg-v2-background-bg-base p-3 shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]"
                      >
                        <p class="text-[12px] leading-5 text-v2-text-text-base [font-weight:530]">
                          {state.googleConfirm === "delete"
                            ? language.t("secondBrain.calendar.google.confirm.delete")
                            : language.t("secondBrain.calendar.google.confirm.save")}
                        </p>
                        <p class="mt-1 text-[11px] leading-4 text-v2-text-text-faint">
                          {state.draft.date}
                          <Show when={state.draft.start && state.draft.end}>
                            {` · ${state.draft.start}–${state.draft.end} · ${state.draft.timezone}`}
                          </Show>
                        </p>
                        <div class="mt-3 flex justify-end gap-2">
                          <ButtonV2
                            type="button"
                            size="small"
                            variant="ghost"
                            disabled={state.saving}
                            onClick={() => setState({ googleConfirm: "", googleWriteKey: "" })}
                          >
                            {language.t("common.cancel")}
                          </ButtonV2>
                          <ButtonV2
                            type="button"
                            size="small"
                            variant={state.googleConfirm === "delete" ? "danger" : "contrast"}
                            disabled={state.saving}
                            onClick={() => void confirmGoogleWrite()}
                          >
                            {state.saving
                              ? language.t("secondBrain.saving")
                              : language.t("secondBrain.calendar.google.confirm.action")}
                          </ButtonV2>
                        </div>
                      </div>
                    </Show>
                    <Show when={state.error}>
                      <p role="alert" class="text-[12px] text-v2-text-text-critical">
                        {state.error}
                      </p>
                    </Show>
                    <div class="flex items-center justify-between gap-2">
                      <Show when={state.draft.id} fallback={<span />}>
                        <ButtonV2
                          type="button"
                          size="small"
                          variant="danger"
                          disabled={state.saving || Boolean(state.googleConfirm)}
                          onClick={() => void remove()}
                        >
                          {language.t("common.delete")}
                        </ButtonV2>
                      </Show>
                      <ButtonV2
                        type="submit"
                        size="small"
                        variant="contrast"
                        disabled={state.saving || Boolean(state.googleConfirm)}
                      >
                        {state.saving ? language.t("secondBrain.saving") : language.t("common.save")}
                      </ButtonV2>
                    </div>
                  </form>
                </Show>
              </aside>
            </Show>
          </div>
        </Show>
      </Show>
    </PageFrame>
  )
}

const calendarNavigation = ["today", "week", "month", "agenda", "tasks"] as const

const fieldClass = "flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted"

const noteClass = "rounded-[12px] bg-v2-background-bg-base px-3 py-2 text-[12px] leading-5 text-v2-text-text-muted"

const dateInputClass =
  "h-9 w-full min-w-0 rounded-[12px] border-0 bg-v2-background-bg-base px-3 text-[12px] text-v2-text-text-base outline-none transition-shadow duration-150 ease-standard focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"

function calendarView(value?: string): CalendarView {
  if (
    value === "week" ||
    value === "month" ||
    value === "agenda" ||
    value === "tasks" ||
    value === "upcoming" ||
    value === "unscheduled" ||
    value === "completed"
  ) {
    return value
  }
  return "today"
}

function taskFilter(view: CalendarView): CalendarTaskFilter | undefined {
  if (view === "tasks") return "today"
  if (view === "upcoming") return "upcoming"
  if (view === "unscheduled") return "unscheduled"
  if (view === "completed") return "completed"
}

function viewForTaskFilter(filter: CalendarTaskFilter): CalendarView {
  if (filter === "upcoming") return "upcoming"
  if (filter === "unscheduled") return "unscheduled"
  if (filter === "completed") return "completed"
  return "tasks"
}

function scheduleTime(item: ScheduleItem) {
  return item.kind === "event" ? (item.event.start ?? "") : (item.task.start ?? "")
}

function googleTaskFields(task: PlannerTask) {
  return JSON.stringify({
    title: task.title,
    notes: task.notes ?? "",
    dueDate: task.dueDate ?? "",
    completedAt: task.completedAt ?? "",
  })
}

function ScheduleRow(props: {
  item: ScheduleItem
  today: string
  projects: ReadonlyArray<ProjectRecord>
  onOpenEvent: (event: CalendarEvent) => void
  onOpenTask: (task: PlannerTask) => void
  eventSource: (source: CalendarEvent["source"]) => string
  taskLabel: string
}) {
  const event = props.item.kind === "event" ? props.item.event : undefined
  const task = props.item.kind === "task" ? props.item.task : undefined
  return (
    <button
      type="button"
      class={`${pageRowClass} min-h-12 cursor-pointer`}
      onClick={() => (event ? props.onOpenEvent(event) : task ? props.onOpenTask(task) : undefined)}
    >
      <span class="flex w-32 shrink-0 items-center gap-1.5 text-[12px] tabular-nums text-v2-text-text-faint">
        <Show when={props.item.date === props.today}>
          <span class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-accent" />
        </Show>
        <span>
          {props.item.date}
          <Show when={event?.endDate}>–{event?.endDate}</Show>
          <Show when={event?.start ?? task?.start}> {event?.start ?? task?.start}</Show>
        </span>
      </span>
      <span class="flex min-w-0 flex-1 items-center gap-2">
        <Show
          when={event}
          fallback={<span class="size-3.5 shrink-0 rounded-full border border-v2-border-border-base" />}
        >
          <span class="h-3.5 w-1 shrink-0 rounded-full bg-v2-icon-icon-accent" />
        </Show>
        <span class="min-w-0">
          <span class="block truncate text-[13px] text-v2-text-text-base">{props.item.title}</span>
          <Show when={props.item.projectId}>
            {(id) => (
              <span class="block truncate text-[11px] text-v2-text-text-faint">
                {props.projects.find((project) => project.id === id())?.name ?? id()}
              </span>
            )}
          </Show>
        </span>
      </span>
      <span class="shrink-0 text-[11px] text-v2-text-text-faint">
        {event ? props.eventSource(event.source) : `${props.eventSource(task?.source ?? "local")} · ${props.taskLabel}`}
      </span>
    </button>
  )
}
