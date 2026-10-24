import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, pageRowClass } from "@/components/page"
import { useLanguage } from "@/context/language"
import { localDateKey } from "./calendar-domain"
import type { PlannerTask, ProjectRecord } from "./client"

export type CalendarTaskFilter = "today" | "upcoming" | "unscheduled" | "completed"
type TaskErrorKey =
  | "secondBrain.tasks.error.title"
  | "secondBrain.tasks.error.schedule"
  | "secondBrain.tasks.error.scheduledDate"
  | "secondBrain.tasks.error.time"
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
  selectedId?: string
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
    errorField: "" as "" | "title" | "time" | "scheduled",
  })
  createEffect(() => {
    if (props.filter && props.filter !== state.filter) setState("filter", props.filter)
  })
  const today = () => localDateKey(new Date())
  const visible = createMemo(() => {
    // One date for the whole pass instead of one per task and comparison.
    const now = today()
    return props.tasks
      .filter((task) => {
        if (task.id === props.selectedId) return true
        if (state.filter === "completed") return Boolean(task.completedAt)
        if (task.completedAt) return false
        if (state.filter === "today") {
          return task.scheduledDate === now || Boolean(task.dueDate && task.dueDate <= now)
        }
        if (state.filter === "upcoming") {
          return Boolean(
            (task.scheduledDate && task.scheduledDate > now) ||
              (!task.scheduledDate && task.dueDate && task.dueDate > now),
          )
        }
        return !task.scheduledDate
      })
      .sort(
        (left, right) =>
          (left.scheduledDate ?? left.dueDate ?? "9999").localeCompare(
            right.scheduledDate ?? right.dueDate ?? "9999",
          ) || left.title.localeCompare(right.title),
      )
  })
  const dateFormat = createMemo(
    () => new Intl.DateTimeFormat(language.locale(), { weekday: "short", month: "short", day: "numeric" }),
  )
  const formatDate = (date: string) => dateFormat().format(new Date(`${date}T12:00:00`))

  const openTask = (task: PlannerTask) =>
    setState({
      editing: true,
      confirmingDelete: false,
      googleConfirm: false,
      error: "",
      errorField: "",
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

  let openedSelection: string | undefined
  createEffect(
    on(
      () => [props.selectedId, props.tasks] as const,
      ([id, tasks]) => {
        if (!id) openedSelection = undefined
        const task = tasks.find((item) => item.id === id)
        if (task && openedSelection !== id) {
          openedSelection = id
          openTask(task)
        }
      },
    ),
  )

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

  const fail = (field: "title" | "time" | "scheduled", key: TaskErrorKey) =>
    setState({ error: language.t(key), errorField: field })

  const save = async () => {
    const title = state.draft.title.trim()
    if (!title) return fail("title", "secondBrain.tasks.error.title")
    if (Boolean(state.draft.start) !== Boolean(state.draft.end)) return fail("time", "secondBrain.tasks.error.schedule")
    if (state.draft.start && !state.draft.scheduledDate)
      return fail("scheduled", "secondBrain.tasks.error.scheduledDate")
    if (state.draft.start && state.draft.end <= state.draft.start) return fail("time", "secondBrain.tasks.error.time")
    setState("errorField", "")
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
    <div
      classList={{
        "grid min-h-0 flex-1 gap-3 px-3 pb-3": true,
        "lg:grid-cols-[minmax(0,1fr)_320px]": state.editing,
      }}
    >
      <section class="flex min-h-0 min-w-0 flex-col" aria-label={language.t("secondBrain.tasks.title")}>
        <div class="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
          <div class="min-w-0 flex-1">
            <SegmentedControlV2 class="!w-fit" value={state.filter}>
              <For each={["today", "upcoming", "unscheduled", "completed"] as const}>
                {(filter) => (
                  <SegmentedControlItemV2
                    value={filter}
                    class="!flex-auto whitespace-nowrap"
                    onClick={() => {
                      setState("filter", filter)
                      props.onFilterChange?.(filter)
                    }}
                  >
                    {language.t(`secondBrain.tasks.filter.${filter}`)}
                  </SegmentedControlItemV2>
                )}
              </For>
            </SegmentedControlV2>
          </div>
          <ButtonV2
            size="small"
            variant="contrast"
            icon="plus"
            onClick={() =>
              setState({
                editing: true,
                draft: emptyDraft(),
                error: "",
                errorField: "",
                confirmingDelete: false,
                googleConfirm: false,
              })
            }
          >
            {language.t("secondBrain.tasks.new")}
          </ButtonV2>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          <Show when={visible().length > 0} fallback={<PageEmpty>{language.t("secondBrain.tasks.empty")}</PageEmpty>}>
            <For each={visible()}>
              {(task) => (
                <div
                  class={`${pageRowClass} min-h-12 py-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_48px]`}
                >
                  <span class="relative flex size-5 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={Boolean(task.completedAt)}
                      aria-label={language.t("secondBrain.tasks.toggle", { title: task.title })}
                      class="peer size-5 cursor-pointer appearance-none rounded-full border-[1.5px] border-v2-border-border-base transition-colors duration-150 ease-standard checked:border-transparent checked:bg-v2-icon-icon-accent hover:border-v2-icon-icon-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                      onChange={() => void toggleComplete(task)}
                    />
                    <Icon
                      name="check"
                      size="small"
                      class="pointer-events-none absolute text-v2-icon-icon-contrast opacity-0 peer-checked:opacity-100"
                    />
                  </span>
                  <button
                    type="button"
                    class="min-w-0 flex-1 cursor-pointer rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                    onClick={() => openTask(task)}
                  >
                    <span
                      classList={{
                        "block truncate text-[13px]": true,
                        "text-v2-text-text-base": !task.completedAt,
                        "text-v2-text-text-faint line-through": Boolean(task.completedAt),
                      }}
                    >
                      {task.title}
                    </span>
                    <span class="block truncate text-[11px] text-v2-text-text-faint">
                      {(task.scheduledDate ?? task.dueDate)
                        ? formatDate((task.scheduledDate ?? task.dueDate)!)
                        : language.t("secondBrain.tasks.unscheduled")}
                      <Show when={task.start}> {task.start}</Show>
                      <Show when={task.projectId}>
                        {(id) =>
                          ` · ${props.projects.find((project) => project.id === id())?.name ?? language.t("secondBrain.tasks.noProject")}`
                        }
                      </Show>
                      <Show when={task.source === "google"}> · {task.taskListTitle}</Show>
                    </span>
                  </button>
                  <span class="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-v2-text-text-faint">
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

      <Show when={state.editing}>
        <aside
          ref={(element) => revealEditor(element)}
          class="flex min-h-0 flex-col overflow-y-auto rounded-[24px] bg-v2-background-bg-layer-01"
        >
          <form
            class="flex flex-col gap-3 p-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || event.defaultPrevented) return
              event.preventDefault()
              setState({ editing: false, confirmingDelete: false, googleConfirm: false })
            }}
          >
            <div class="flex items-center gap-2">
              <h3 class="min-w-0 flex-1 text-[14px] text-v2-text-text-base [font-weight:530]">
                {state.draft.id ? language.t("secondBrain.tasks.edit") : language.t("secondBrain.tasks.new")}
              </h3>
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
            <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-title">
              {language.t("secondBrain.tasks.name")}
              <TextInputV2
                id="task-title"
                ref={(element) => queueMicrotask(() => element.focus())}
                value={state.draft.title}
                invalid={state.errorField === "title"}
                aria-describedby={state.errorField === "title" ? "task-error" : undefined}
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
                class={dateInputClass}
                value={state.draft.dueDate}
                onInput={(event) => setState("draft", "dueDate", event.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-scheduled">
              {language.t("secondBrain.tasks.scheduled")}
              <input
                id="task-scheduled"
                type="date"
                class={dateInputClass}
                aria-invalid={state.errorField === "scheduled" ? true : undefined}
                aria-describedby={state.errorField === "scheduled" ? "task-error" : undefined}
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
                  class={dateInputClass}
                  aria-invalid={state.errorField === "time" ? true : undefined}
                  aria-describedby={state.errorField === "time" ? "task-error" : undefined}
                  value={state.draft.start}
                  onInput={(event) => setState("draft", "start", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted" for="task-end">
                {language.t("secondBrain.calendar.end")}
                <input
                  id="task-end"
                  type="time"
                  class={dateInputClass}
                  aria-invalid={state.errorField === "time" ? true : undefined}
                  aria-describedby={state.errorField === "time" ? "task-error" : undefined}
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
              <p id="task-error" role="alert" class="text-[12px] text-v2-text-text-critical">
                {state.error}
              </p>
            </Show>
            <Show when={state.googleConfirm}>
              <p
                role="status"
                class="rounded-[12px] bg-v2-background-bg-base px-3 py-2 text-[12px] leading-5 text-v2-text-text-muted"
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
        </aside>
      </Show>
    </div>
  )
}

/** Below the two-column layout the editor opens under the list; bring it into view. */
function revealEditor(element: HTMLElement) {
  queueMicrotask(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) return
    element.scrollIntoView({ block: "nearest", behavior: "smooth" })
  })
}

const dateInputClass =
  "h-9 w-full min-w-0 rounded-[12px] border-0 bg-v2-background-bg-base px-3 text-[12px] text-v2-text-text-base outline-none transition-shadow duration-150 ease-standard focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
