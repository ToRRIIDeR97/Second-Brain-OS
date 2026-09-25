import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { localDateKey } from "./calendar-domain"
import type { PlannerTask, ProjectRecord } from "./client"

export type CalendarTaskFilter = "today" | "upcoming" | "unscheduled" | "completed"
type Draft = {
  id: string
  title: string
  notes: string
  projectId: string
  dueDate: string
  scheduledDate: string
  start: string
  end: string
  completedAt: string
  createdAt: string
  source: PlannerTask["source"]
  syncState: PlannerTask["syncState"]
  providerId: string
  taskListId: string
  taskListTitle: string
  etag: string
  outboxKind: PlannerTask["outboxKind"] | ""
  outboxKey: string
}

const emptyDraft = (): Draft => ({
  id: "",
  title: "",
  notes: "",
  projectId: "",
  dueDate: "",
  scheduledDate: "",
  start: "",
  end: "",
  completedAt: "",
  createdAt: "",
  source: "local",
  syncState: "local",
  providerId: "",
  taskListId: "",
  taskListTitle: "",
  etag: "",
  outboxKind: "",
  outboxKey: "",
})

export function CalendarTasks(props: {
  tasks: ReadonlyArray<PlannerTask>
  projects: ReadonlyArray<ProjectRecord>
  onSave: (tasks: ReadonlyArray<PlannerTask>) => Promise<void>
  filter?: CalendarTaskFilter
  onFilterChange?: (filter: CalendarTaskFilter) => void
  googleCanWrite?: boolean
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    filter: (props.filter ?? "today") as CalendarTaskFilter,
    editing: false,
    draft: emptyDraft(),
    saving: false,
    confirmingDelete: false,
    googleConfirm: false,
    error: "",
  })
  createEffect(() => {
    if (props.filter && props.filter !== state.filter) setState("filter", props.filter)
  })
  const today = () => localDateKey(new Date())
  const visible = createMemo(() =>
    props.tasks
      .filter((task) => {
        if (state.filter === "completed") return Boolean(task.completedAt)
        if (task.completedAt) return false
        if (state.filter === "today") {
          return task.scheduledDate === today() || Boolean(task.dueDate && task.dueDate <= today())
        }
        if (state.filter === "upcoming") {
          return Boolean(
            (task.scheduledDate && task.scheduledDate > today()) ||
              (!task.scheduledDate && task.dueDate && task.dueDate > today()),
          )
        }
        return !task.scheduledDate
      })
      .sort(
        (left, right) =>
          (left.scheduledDate ?? left.dueDate ?? "9999").localeCompare(
            right.scheduledDate ?? right.dueDate ?? "9999",
          ) || left.title.localeCompare(right.title),
      ),
  )

  const openTask = (task: PlannerTask) =>
    setState({
      editing: true,
      confirmingDelete: false,
      googleConfirm: false,
      error: "",
      draft: {
        id: task.id,
        title: task.title,
        notes: task.notes ?? "",
        projectId: task.projectId ?? "",
        dueDate: task.dueDate ?? "",
        scheduledDate: task.scheduledDate ?? "",
        start: task.start ?? "",
        end: task.end ?? "",
        completedAt: task.completedAt ?? "",
        createdAt: task.createdAt,
        source: task.source,
        syncState: task.syncState,
        providerId: task.providerId ?? "",
        taskListId: task.taskListId ?? "",
        taskListTitle: task.taskListTitle ?? "",
        etag: task.etag ?? "",
        outboxKind: task.outboxKind ?? "",
        outboxKey: task.outboxKey ?? "",
      },
    })

  const persist = async (tasks: ReadonlyArray<PlannerTask>) => {
    setState({ saving: true, error: "" })
    try {
      await props.onSave(tasks)
      setState({ editing: false, draft: emptyDraft(), confirmingDelete: false, googleConfirm: false })
    } catch {
      setState("error", language.t("secondBrain.tasks.error.request"))
    } finally {
      setState("saving", false)
    }
  }

  const save = async () => {
    const title = state.draft.title.trim()
    if (!title) {
      setState("error", language.t("secondBrain.tasks.error.title"))
      return
    }
    if (Boolean(state.draft.start) !== Boolean(state.draft.end) || (state.draft.start && !state.draft.scheduledDate)) {
      setState("error", language.t("secondBrain.tasks.error.schedule"))
      return
    }
    if (state.draft.start && state.draft.end <= state.draft.start) {
      setState("error", language.t("secondBrain.tasks.error.time"))
      return
    }
    const now = new Date().toISOString()
    const id = state.draft.id || crypto.randomUUID()
    const task: PlannerTask = {
      id,
      title,
      ...(state.draft.notes.trim() ? { notes: state.draft.notes.trim() } : {}),
      ...(state.draft.projectId ? { projectId: state.draft.projectId } : {}),
      ...(state.draft.dueDate ? { dueDate: state.draft.dueDate } : {}),
      ...(state.draft.scheduledDate ? { scheduledDate: state.draft.scheduledDate } : {}),
      ...(state.draft.start ? { start: state.draft.start, end: state.draft.end } : {}),
      ...(state.draft.completedAt ? { completedAt: state.draft.completedAt } : {}),
      ...(state.draft.source === "google"
        ? {
            providerId: state.draft.providerId || `pending:${id}`,
            taskListId: state.draft.taskListId || "@default",
            taskListTitle: state.draft.taskListTitle || language.t("secondBrain.tasks.google.defaultList"),
            ...(state.draft.etag ? { etag: state.draft.etag } : {}),
            ...(state.draft.outboxKind ? { outboxKind: state.draft.outboxKind } : {}),
            ...(state.draft.outboxKey ? { outboxKey: state.draft.outboxKey } : {}),
          }
        : {}),
      createdAt: state.draft.createdAt || now,
      updatedAt: now,
      source: state.draft.source,
      syncState: state.draft.source === "google" ? state.draft.syncState || "pending" : "local",
    }
    const original = props.tasks.find((current) => current.id === state.draft.id)
    const providerChanged =
      task.source === "google" &&
      (!original ||
        JSON.stringify([original.title, original.notes ?? "", original.dueDate ?? "", original.completedAt ?? ""]) !==
          JSON.stringify([task.title, task.notes ?? "", task.dueDate ?? "", task.completedAt ?? ""]))
    if (providerChanged && !state.googleConfirm) {
      setState("googleConfirm", true)
      return
    }
    await persist(
      state.draft.id
        ? props.tasks.map((current) => (current.id === state.draft.id ? task : current))
        : [...props.tasks, task],
    )
  }

  const toggleComplete = (task: PlannerTask) => {
    const now = new Date().toISOString()
    if (task.source === "google") {
      openTask({ ...task, completedAt: task.completedAt ? undefined : now, updatedAt: now })
      setState("googleConfirm", true)
      return Promise.resolve()
    }
    return persist(
      props.tasks.map((current) =>
        current.id === task.id
          ? { ...current, completedAt: current.completedAt ? undefined : now, updatedAt: now }
          : current,
      ),
    )
  }

  const remove = () => persist(props.tasks.filter((task) => task.id !== state.draft.id))

  return (
    <div class="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section
        class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
        aria-labelledby="tasks-title"
      >
        <div class="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-v2-border-border-weak px-3 py-2">
          <h2 id="tasks-title" class="min-w-0 flex-1 text-[14px] text-v2-text-text-base [font-weight:530]">
            {language.t("secondBrain.tasks.title")}
          </h2>
          <For each={["today", "upcoming", "unscheduled", "completed"] as const}>
            {(filter) => (
              <ButtonV2
                size="small"
                variant={state.filter === filter ? "outline" : "ghost-muted"}
                onClick={() => {
                  setState("filter", filter)
                  props.onFilterChange?.(filter)
                }}
              >
                {language.t(`secondBrain.tasks.filter.${filter}`)}
              </ButtonV2>
            )}
          </For>
          <ButtonV2
            size="small"
            variant="contrast"
            icon="plus"
            onClick={() =>
              setState({ editing: true, draft: emptyDraft(), error: "", confirmingDelete: false, googleConfirm: false })
            }
          >
            {language.t("secondBrain.tasks.new")}
          </ButtonV2>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <Show
            when={visible().length > 0}
            fallback={<p class="p-4 text-[12px] text-v2-text-text-faint">{language.t("secondBrain.tasks.empty")}</p>}
          >
            <For each={visible()}>
              {(task) => (
                <div class="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[6px] px-2 transition-colors duration-150 hover:bg-v2-background-bg-layer-01">
                  <input
                    type="checkbox"
                    checked={Boolean(task.completedAt)}
                    aria-label={language.t("secondBrain.tasks.toggle", { title: task.title })}
                    class="size-4 cursor-pointer accent-current"
                    onChange={() => void toggleComplete(task)}
                  />
                  <button
                    type="button"
                    class="min-w-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
                    onClick={() => openTask(task)}
                  >
                    <span class="block truncate text-[13px] text-v2-text-text-base">{task.title}</span>
                    <span class="block truncate text-[11px] text-v2-text-text-faint">
                      {task.scheduledDate ?? task.dueDate ?? language.t("secondBrain.tasks.unscheduled")}
                      <Show when={task.start}> {task.start}</Show>
                      <Show when={task.projectId}>
                        {(id) => ` · ${props.projects.find((project) => project.id === id())?.name ?? id()}`}
                      </Show>
                      <Show when={task.source === "google"}> · {task.taskListTitle}</Show>
                    </span>
                  </button>
                  <span class="flex flex-col items-end gap-0.5 text-[10px] text-v2-text-text-faint">
                    <Show when={task.dueDate && !task.completedAt && task.dueDate < today()}>
                      <span class="text-[11px] text-v2-text-text-critical">
                        {language.t("secondBrain.tasks.overdue")}
                      </span>
                    </Show>
                    <span>
                      {language.t(`secondBrain.calendar.source.${task.source}`)}
                      <Show when={task.source === "google" && task.syncState !== "synced"}>
                        {` · ${language.t(`secondBrain.calendar.sync.${task.syncState}`)}`}
                      </Show>
                    </span>
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>

      <aside class="flex min-h-0 flex-col overflow-y-auto rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
        <Show
          when={state.editing}
          fallback={
            <div class="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-v2-text-text-faint">
              {language.t("secondBrain.tasks.select")}
            </div>
          }
        >
          <form
            class="flex flex-col gap-4 p-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <div class="flex items-center gap-2">
              <h3 class="min-w-0 flex-1 text-[14px] text-v2-text-text-base [font-weight:530]">
                {state.draft.id ? language.t("secondBrain.tasks.edit") : language.t("secondBrain.tasks.new")}
              </h3>
              <ButtonV2 type="button" size="small" variant="ghost" onClick={() => setState("editing", false)}>
                {language.t("common.cancel")}
              </ButtonV2>
            </div>
            <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-title">
              {language.t("secondBrain.tasks.name")}
              <TextInputV2
                id="task-title"
                autofocus
                value={state.draft.title}
                onInput={(event) => setState("draft", "title", event.currentTarget.value)}
              />
            </label>
            <Show
              when={!state.draft.id && props.googleCanWrite}
              fallback={
                <Show when={state.draft.source === "google"}>
                  <p class="text-[11px] text-v2-text-text-faint">
                    {state.draft.taskListTitle || language.t("secondBrain.tasks.google.defaultList")} ·{" "}
                    {language.t(`secondBrain.calendar.sync.${state.draft.syncState}`)}
                  </p>
                </Show>
              }
            >
              <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-source">
                {language.t("secondBrain.tasks.google.destination")}
                <SelectV2
                  id="task-source"
                  aria-label={language.t("secondBrain.tasks.google.destination")}
                  class="!h-8 !w-full"
                  options={["local", "google"] as const}
                  current={state.draft.source === "google" ? "google" : "local"}
                  label={(source) =>
                    source === "google"
                      ? language.t("secondBrain.tasks.google.defaultList")
                      : language.t("secondBrain.calendar.sync.local")
                  }
                  onSelect={(source) =>
                    setState("draft", {
                      ...state.draft,
                      source: source === "google" ? "google" : "local",
                      syncState: source === "google" ? "pending" : "local",
                    })
                  }
                />
              </label>
            </Show>
            <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-project">
              {language.t("secondBrain.calendar.project")}
              <SelectV2
                id="task-project"
                aria-label={language.t("secondBrain.calendar.project")}
                class="!h-8 !w-full"
                options={["__none__", ...props.projects.map((project) => project.id)]}
                current={state.draft.projectId || "__none__"}
                label={(projectID) =>
                  projectID === "__none__"
                    ? language.t("secondBrain.calendar.noProject")
                    : (props.projects.find((project) => project.id === projectID)?.name ?? projectID)
                }
                onSelect={(projectID) =>
                  setState("draft", "projectId", projectID === "__none__" ? "" : (projectID ?? ""))
                }
              />
            </label>
            <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-due">
              {language.t("secondBrain.tasks.due")}
              <input
                id="task-due"
                type="date"
                class="h-8 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[12px] text-v2-text-text-base outline-none focus-visible:border-v2-border-border-focus"
                value={state.draft.dueDate}
                onInput={(event) => setState("draft", "dueDate", event.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-scheduled">
              {language.t("secondBrain.tasks.scheduled")}
              <input
                id="task-scheduled"
                type="date"
                class="h-8 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[12px] text-v2-text-text-base outline-none focus-visible:border-v2-border-border-focus"
                value={state.draft.scheduledDate}
                onInput={(event) => setState("draft", "scheduledDate", event.currentTarget.value)}
              />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-start">
                {language.t("secondBrain.calendar.start")}
                <input
                  id="task-start"
                  type="time"
                  class="h-8 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[12px] text-v2-text-text-base outline-none focus-visible:border-v2-border-border-focus"
                  value={state.draft.start}
                  onInput={(event) => setState("draft", "start", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-end">
                {language.t("secondBrain.calendar.end")}
                <input
                  id="task-end"
                  type="time"
                  class="h-8 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[12px] text-v2-text-text-base outline-none focus-visible:border-v2-border-border-focus"
                  value={state.draft.end}
                  onInput={(event) => setState("draft", "end", event.currentTarget.value)}
                />
              </label>
            </div>
            <Show when={state.draft.scheduledDate}>
              <ButtonV2
                type="button"
                size="small"
                variant="ghost"
                onClick={() => setState("draft", { ...state.draft, scheduledDate: "", start: "", end: "" })}
              >
                {language.t("secondBrain.tasks.unschedule")}
              </ButtonV2>
            </Show>
            <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-notes">
              {language.t("secondBrain.tasks.notes")}
              <TextareaV2
                id="task-notes"
                rows={4}
                value={state.draft.notes}
                onInput={(event) => setState("draft", "notes", event.currentTarget.value)}
              />
            </label>
            <Show when={state.error}>
              <p role="alert" class="text-[12px] text-v2-text-text-critical">
                {state.error}
              </p>
            </Show>
            <Show when={state.googleConfirm}>
              <p
                role="status"
                class="rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 text-[12px] leading-5 text-v2-text-text-muted"
              >
                {language.t("secondBrain.tasks.google.confirm")}
              </p>
            </Show>
            <div class="flex items-center justify-between gap-2">
              <Show when={state.draft.id} fallback={<span />}>
                <ButtonV2
                  type="button"
                  size="small"
                  variant="danger"
                  disabled={state.saving}
                  onClick={() => (state.confirmingDelete ? void remove() : setState("confirmingDelete", true))}
                >
                  {state.confirmingDelete ? language.t("secondBrain.tasks.confirmDelete") : language.t("common.delete")}
                </ButtonV2>
              </Show>
              <ButtonV2 type="submit" size="small" variant="contrast" disabled={state.saving}>
                {state.saving
                  ? language.t("secondBrain.saving")
                  : state.googleConfirm
                    ? language.t("secondBrain.tasks.google.confirmAction")
                    : language.t("common.save")}
              </ButtonV2>
            </div>
          </form>
        </Show>
      </aside>
    </div>
  )
}
