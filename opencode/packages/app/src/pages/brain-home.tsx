import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createEffect, createMemo, createResource, For, Show, Suspense } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useDrafts } from "@/context/drafts"
import { useCommand } from "@/context/command"
import { PageFrame, PageSection, pageRowClass } from "@/components/page"
import { localDateKey } from "@/features/second-brain/calendar-domain"
import { listProjects, readCalendar, type CalendarEvent, type PlannerTask } from "@/features/second-brain/client"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { Harness } from "@opencode-ai/schema/harness"
import { fallbackHarnesses, listHarnessesForServer } from "@/utils/server"

type TodayItem = { kind: "event"; value: CalendarEvent } | { kind: "task"; value: PlannerTask; overdue: boolean }

export default function BrainHomePage() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const drafts = useDrafts()
  const command = useCommand()
  const openCodeHome = createHomeController()
  const openCodeSessions = createHomeSessionsController(openCodeHome)
  const [state, setState] = createStore({
    directory: "",
    prompt: "",
    harnessInstanceID: Harness.OpenCode,
    starting: false,
  })
  const locations = layout.projects.list
  const client = (directory: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory },
  })

  createEffect(() => {
    const available = locations()
    if (available.some((location) => location.worktree === state.directory)) return
    const preferred = layout.home.selection().directory
    setState(
      "directory",
      available.find((location) => location.worktree === preferred)?.worktree ?? available[0]?.worktree ?? "",
    )
  })

  const [projects] = createResource(
    () => state.directory || undefined,
    (directory) => listProjects(client(directory)),
  )
  const [calendar] = createResource(
    () => state.directory || undefined,
    (directory) => readCalendar(client(directory)),
  )
  const harnessQuery = useQuery(() => ({
    queryKey: ["home", "harnesses", server.key, state.directory],
    enabled: !!state.directory,
    queryFn: () =>
      listHarnessesForServer({ server: serverSDK().server.http, fetch: platform.fetch }, state.directory).catch(
        fallbackHarnesses,
      ),
    staleTime: 30_000,
    refetchOnMount: true,
    retry: false,
  }))
  const harnesses = () => harnessQuery.data
  createEffect(() => {
    if (harnessQuery.isPending) return
    const available = harnesses()
    if (!available) return
    const current = available.find((instance) => instance.id === state.harnessInstanceID)
    if (current?.status === "available") return
    const fallback = available.find((instance) => instance.status === "available")
    if (fallback) setState("harnessInstanceID", fallback.id)
  })
  const today = localDateKey(new Date())
  const activeProjects = createMemo(() =>
    (projects.loading ? [] : (projects() ?? []))
      .filter((project) => project.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 5),
  )
  const projectNames = createMemo(
    () => new Map((projects.loading ? [] : (projects() ?? [])).map((project) => [project.id, project.name])),
  )
  const todayItems = createMemo<TodayItem[]>(() => {
    if (calendar.loading) return []
    const events = (calendar()?.events ?? [])
      .filter((event) => event.date === today)
      .map((value): TodayItem => ({ kind: "event", value }))
    const tasks = (calendar()?.tasks ?? [])
      .filter(
        (task) =>
          !task.completedAt &&
          (task.scheduledDate === today || task.dueDate === today || (!!task.dueDate && task.dueDate < today)),
      )
      .map((value): TodayItem => ({ kind: "task", value, overdue: !!value.dueDate && value.dueDate < today }))
    return [...events, ...tasks]
      .sort((left, right) => {
        const leftTime = left.kind === "event" ? (left.value.start ?? "") : (left.value.start ?? "")
        const rightTime = right.kind === "event" ? (right.value.start ?? "") : (right.value.start ?? "")
        return leftTime.localeCompare(rightTime) || left.value.title.localeCompare(right.value.title)
      })
      .slice(0, 8)
  })
  const runningSessions = createMemo(() => {
    const data = openCodeHome.server.focusedSync().session.data
    return openCodeSessions.data.records().filter((record) => {
      const status = data.session_status[record.session.id]
      return (status?.type ?? "idle") !== "idle" || (data.permission[record.session.id]?.length ?? 0) > 0
    })
  })

  const startSession = async () => {
    const prompt = state.prompt.trim()
    if (!prompt || !state.directory || state.starting || harnessQuery.isPending) return
    setState("starting", true)
    try {
      await drafts.create(
        { server: server.key, directory: state.directory },
        prompt,
        undefined,
        state.harnessInstanceID,
      )
    } finally {
      setState("starting", false)
    }
  }

  return (
    <PageFrame labelledBy="brain-home-title">
      <h1 id="brain-home-title" class="sr-only">
        {language.t("secondBrain.home.title")}
      </h1>
      <div class="flex h-14 items-center gap-2 px-4">
        <Show when={locations().length > 0}>
          <SelectV2
            id="brain-home-location"
            aria-label={language.t("secondBrain.workspace")}
            class="!h-8 !w-auto max-w-56"
            appearance="inline"
            options={locations()}
            current={locations().find((location) => location.worktree === state.directory)}
            value={(location) => location.worktree}
            label={(location) => location.name ?? location.worktree.split(/[\\/]/).pop() ?? location.worktree}
            onSelect={(location) => {
              if (!location) return
              const directory = location.worktree
              setState("directory", directory)
              layout.home.setSelection({ server: server.key, directory })
            }}
          />
        </Show>
        <span class="flex-1" />
        <TooltipV2 value={language.t("secondBrain.home.openWorkspace")} placement="bottom">
          <IconButtonV2
            variant="ghost"
            size="large"
            class="!size-9"
            aria-label={language.t("secondBrain.home.openWorkspace")}
            icon={<Icon name="folder-add-left" size="small" />}
            onClick={() => command.trigger("project.open")}
          />
        </TooltipV2>
      </div>

      <Show
        when={state.directory}
        fallback={
          <div class="flex flex-col items-center gap-4 px-6 pt-[15vh] text-center">
            <h2 class="text-[17px] text-v2-text-text-base [font-weight:560]">
              {language.t("secondBrain.home.empty.title")}
            </h2>
            <ButtonV2 variant="contrast" onClick={() => command.trigger("project.open")}>
              {language.t("secondBrain.home.openWorkspace")}
            </ButtonV2>
          </div>
        }
      >
        <div class="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-6 pb-12 pt-[15vh]">
          <form
            class="flex flex-col gap-2 rounded-[28px] bg-v2-background-bg-base p-3 shadow-[0_0_0_1px_var(--v2-border-border-base),0_8px_28px_-12px_rgb(0_0_0/0.18)] transition-shadow duration-200 ease-standard focus-within:shadow-[0_0_0_1px_var(--v2-border-border-focus),0_8px_28px_-12px_rgb(0_0_0/0.18)] motion-reduce:transition-none"
            onSubmit={(event) => {
              event.preventDefault()
              void startSession()
            }}
          >
            <label class="sr-only" for="brain-home-prompt">
              {language.t("secondBrain.home.ask")}
            </label>
            <textarea
              id="brain-home-prompt"
              rows={2}
              class="max-h-60 min-h-12 w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-6 text-v2-text-text-base outline-none [field-sizing:content] placeholder:text-v2-text-text-faint"
              value={state.prompt}
              placeholder={language.t("secondBrain.home.askPlaceholder")}
              onInput={(event) => setState("prompt", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                event.preventDefault()
                void startSession()
              }}
            />
            <div class="flex items-center gap-2">
              <Suspense
                fallback={
                  <span class="flex h-8 items-center px-2 text-[12px] text-v2-text-text-faint">
                    {language.t("harness.checking")}
                  </span>
                }
              >
                <SelectV2
                  aria-label={language.t("harness.label")}
                  class="!h-8 !w-auto max-w-[220px]"
                  appearance="inline"
                  options={[...(harnesses() ?? [])]}
                  current={harnesses()?.find((instance) => instance.id === state.harnessInstanceID)}
                  value={(instance) => instance.id}
                  label={(instance) =>
                    `${instance.name}${instance.status === "unavailable" ? ` - ${language.t("harness.unavailable")}` : ""}`
                  }
                  optionDisabled={(instance) => instance.status === "unavailable"}
                  placeholder={language.t("harness.checking")}
                  disabled={harnessQuery.isPending}
                  onSelect={(instance) => instance && setState("harnessInstanceID", instance.id)}
                />
              </Suspense>
              <span class="flex-1" />
              <IconButtonV2
                type="submit"
                variant="contrast"
                size="large"
                class="!size-10"
                aria-label={language.t("secondBrain.home.start")}
                icon={<Icon name="arrow-up" size="small" />}
                disabled={!state.prompt.trim() || state.starting || harnessQuery.isPending}
              />
            </div>
          </form>

          <Show when={!projects.loading && (projects()?.length ?? 0) === 0}>
            <section class="flex flex-col items-center gap-3 text-center" aria-labelledby="brain-home-first-run">
              <h2 id="brain-home-first-run" class="text-[15px] text-v2-text-text-base [font-weight:560]">
                {language.t("secondBrain.home.firstRun.title")}
              </h2>
              <div class="flex flex-wrap justify-center gap-2">
                <ButtonV2 variant="contrast" onClick={() => navigate("/projects")}>
                  {language.t("secondBrain.home.firstRun.project")}
                </ButtonV2>
                <ButtonV2 variant="outline" onClick={() => command.trigger("project.open")}>
                  {language.t("secondBrain.home.firstRun.folder")}
                </ButtonV2>
                <Show when={platform.googleCalendar}>
                  <ButtonV2 variant="ghost" onClick={() => navigate("/calendar?google=connect")}>
                    {language.t("secondBrain.home.firstRun.google")}
                  </ButtonV2>
                </Show>
              </div>
            </section>
          </Show>

          <Show when={runningSessions().length > 0}>
            <PageSection
              id="brain-home-running"
              title={language.t("secondBrain.home.running")}
              onTitle={() => navigate("/activity")}
            >
              <ul class="flex flex-col">
                <For each={runningSessions()}>
                  {(record) => {
                    const approvals = () =>
                      openCodeHome.server.focusedSync().session.data.permission[record.session.id]?.length ?? 0
                    return (
                      <li>
                        <button
                          type="button"
                          class={pageRowClass}
                          onClick={() => openCodeSessions.session.open(record.session)}
                        >
                          <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent animate-[running-pulse_1.6s_var(--v2-ease-standard)_infinite] motion-reduce:animate-none" />
                          <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:470]">
                            {record.session.title}
                          </span>
                          <Show when={approvals() > 0}>
                            <span class="shrink-0 rounded-full bg-v2-state-bg-warning px-2 py-0.5 text-[11px] text-v2-state-fg-warning">
                              {language.t("secondBrain.activity.approvals", { count: approvals() })}
                            </span>
                          </Show>
                          <span class="max-w-40 shrink-0 truncate text-[12px] text-v2-text-text-faint">
                            {record.projectName}
                          </span>
                        </button>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </PageSection>
          </Show>

          <Show when={todayItems().length > 0}>
            <PageSection
              id="brain-home-today"
              title={language.t("secondBrain.home.today")}
              onTitle={() => navigate("/calendar")}
            >
              <ul class="flex flex-col">
                <For each={todayItems()}>
                  {(item) => {
                    const value = item.value
                    const overdue = item.kind === "task" && item.overdue
                    const project = () => (value.projectId ? projectNames().get(value.projectId) : undefined)
                    return (
                      <li>
                        <button
                          type="button"
                          class={pageRowClass}
                          onClick={() =>
                            navigate(
                              `/calendar?${item.kind === "task" ? "view=tasks&task" : "event"}=${encodeURIComponent(item.value.id)}`,
                            )
                          }
                        >
                          <span class="flex w-12 shrink-0 justify-center">
                            <Show
                              when={item.kind === "task"}
                              fallback={
                                <span class="text-[12px] tabular-nums text-v2-text-text-muted">
                                  {value.start || language.t("secondBrain.home.kind.event")}
                                </span>
                              }
                            >
                              <span
                                classList={{
                                  "size-4 rounded-full border-[1.5px]": true,
                                  "border-v2-state-fg-danger": overdue,
                                  "border-v2-border-border-base": !overdue,
                                }}
                              />
                            </Show>
                          </span>
                          <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:470]">
                            {value.title}
                          </span>
                          <Show when={overdue}>
                            <span class="shrink-0 text-[12px] text-v2-state-fg-danger">
                              {language.t("secondBrain.tasks.overdue")}
                            </span>
                          </Show>
                          <Show when={project()}>
                            {(name) => (
                              <span class="max-w-40 shrink-0 truncate text-[12px] text-v2-text-text-faint">
                                {name()}
                              </span>
                            )}
                          </Show>
                        </button>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </PageSection>
          </Show>

          <Show when={activeProjects().length > 0}>
            <PageSection
              id="brain-home-projects"
              title={language.t("secondBrain.home.projects")}
              onTitle={() => navigate("/projects")}
            >
              <ul class="flex flex-col">
                <For each={activeProjects()}>
                  {(project) => (
                    <li>
                      <button
                        type="button"
                        class={pageRowClass}
                        onClick={() => navigate(`/projects?project=${encodeURIComponent(project.id)}`)}
                      >
                        <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:470]">
                          {project.name}
                        </span>
                        <span class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-v2-background-bg-layer-03">
                          <span
                            class="block h-full rounded-full bg-v2-background-bg-accent transition-[width] duration-200 ease-standard motion-reduce:transition-none"
                            style={{ width: `${project.progressPercent}%` }}
                          />
                        </span>
                        <span class="w-9 shrink-0 text-right text-[12px] tabular-nums text-v2-text-text-faint">
                          {project.progressPercent}%
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </PageSection>
          </Show>
        </div>
      </Show>
    </PageFrame>
  )
}
