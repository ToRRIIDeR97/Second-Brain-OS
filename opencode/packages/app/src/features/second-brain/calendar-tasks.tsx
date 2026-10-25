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
import { CalendarPeek, TaskCheck } from "./calendar-peek"
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
  accountId: string
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
  accountId: "",
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
  /** Completes or reopens a task at once, Google tasks included; no editor or confirm step. */
  onToggle: (task: PlannerTask) => Promise<void>
  filter?: CalendarTaskFilter
  selectedId?: string
  onFilterChange?: (filter: CalendarTaskFilter) => void
  /** Google accounts with write access; a new task can be saved to any of them. */
  googleAccounts?: ReadonlyArray<{ id: string; label: string }>
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    filter: (props.filter ?? "today") as CalendarTaskFilter,
    editing: false,
    /** A task shown read-only in the side panel until Edit is chosen. */
    peek: "",
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
  const peeked = createMemo(() => props.tasks.find((task) => task.id === state.peek))
  const visible = createMemo(() =>
    props.tasks
      .filter((task) => {
        if (task.id === props.selectedId) return true
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
      peek: "",
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
        accountId: task.accountId ?? "",
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
            ...(state.draft.accountId ? { accountId: state.draft.accountId } : {}),
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

  const remove = () => persist(props.tasks.filter((task) => task.id !== state.draft.id))

  return (
    <div
      classList={{
        "grid flex-1 items-start gap-3 px-3 pb-3": true,
        "lg:grid-cols-[minmax(0,1fr)_340px]": state.editing || Boolean(peeked()),
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
                peek: "",
                draft: emptyDraft(),
                error: "",
                confirmingDelete: false,
                googleConfirm: false,
              })
            }
          >
            {language.t("secondBrain.tasks.new")}
          </ButtonV2>
        </div>
        <div class="flex flex-col gap-0.5">
          <Show when={visible().length > 0} fallback={<PageEmpty>{language.t("secondBrain.tasks.empty")}</PageEmpty>}>
            <For each={visible()}>
              {(task) => (
                <div
                  classList={{
                    [`${pageRowClass} min-h-12 py-1.5`]: true,
                    "bg-v2-background-bg-accent-container": state.peek === task.id,
                  }}
                >
                  <TaskCheck task={task} onToggle={props.onToggle} />
                  <button
                    type="button"
                    class="min-w-0 flex-1 cursor-pointer rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                    aria-pressed={state.peek === task.id}
                    onClick={() => setState({ peek: task.id, editing: false })}
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
                      {task.scheduledDate ?? task.dueDate ?? language.t("secondBrain.tasks.unscheduled")}
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

      <Show when={!state.editing && peeked()}>
        {(task) => (
          <aside class="flex max-h-[calc(100dvh-8rem)] flex-col overflow-y-auto rounded-[24px] bg-v2-background-bg-layer-01 lg:sticky lg:top-3">
            <CalendarPeek
              tag={`${language.t("secondBrain.home.kind.task")} · ${language.t(`secondBrain.calendar.source.${task().source}`)}`}
              title={task().title}
              when={[
                task().scheduledDate ?? task().dueDate ?? language.t("secondBrain.tasks.unscheduled"),
                task().start && task().end ? `${task().start}–${task().end}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              project={props.projects.find((project) => project.id === task().projectId)?.name}
              notes={task().notes}
              task={task()}
              onToggle={props.onToggle}
              onEdit={() => openTask(task())}
              onClose={() => setState("peek", "")}
            />
          </aside>
        )}
      </Show>
      <Show when={state.editing}>
        <aside class="flex max-h-[calc(100dvh-8rem)] flex-col overflow-y-auto rounded-[24px] bg-v2-background-bg-layer-01 lg:sticky lg:top-3">
          <form
            class="flex flex-col gap-3 p-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
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
                autofocus
                value={state.draft.title}
                onInput={(event) => setState("draft", "title", event.currentTarget.value)}
              />
            </label>
            <Show
              when={!state.draft.id && (props.googleAccounts?.length ?? 0) > 0}
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
                  options={["local", ...(props.googleAccounts ?? []).map((account) => account.id)]}
                  current={state.draft.source === "google" ? state.draft.accountId : "local"}
                  label={(source) => {
                    if (source === "local") return language.t("secondBrain.calendar.sync.local")
                    const account = props.googleAccounts?.find((item) => item.id === source)
                    return language.t("secondBrain.tasks.google.destinationAccount", {
                      account: account?.label ?? language.t("secondBrain.calendar.google.accountFallback"),
                    })
                  }}
                  onSelect={(source) =>
                    source &&
                    setState("draft", {
                      ...state.draft,
                      source: source === "local" ? "local" : "google",
                      accountId: source === "local" ? "" : source,
                      syncState: source === "local" ? "local" : "pending",
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

const dateInputClass =
  "h-9 w-full min-w-0 rounded-[12px] border-0 bg-v2-background-bg-base px-3 text-[12px] text-v2-text-text-base outline-none transition-shadow duration-150 ease-standard focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
