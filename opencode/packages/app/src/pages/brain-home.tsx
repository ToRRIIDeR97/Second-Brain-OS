import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createEffect, createMemo, createResource, For, Show, Suspense } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useTabs } from "@/context/tabs"
import { localDateKey } from "@/features/second-brain/calendar-domain"
import {
  listProjects,
  readCalendar,
  type CalendarEvent,
  type PlannerTask,
  type ProjectRecord,
} from "@/features/second-brain/client"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeSessionsController, type HomeSessionRecord } from "@/pages/home/home-sessions-controller"
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
  const tabs = useTabs()
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
  const outstandingTasks = createMemo(() =>
    calendar.loading ? 0 : (calendar()?.tasks ?? []).filter((task) => !task.completedAt).length,
  )
  const recentSessions = createMemo(() => openCodeSessions.data.records().slice(0, 4))
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
      await tabs.newDraft(
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
    <section class="flex h-full min-h-0 w-full flex-col gap-2 p-2" aria-labelledby="brain-home-title">
      <header class="flex min-h-12 shrink-0 items-center gap-3 rounded-[10px] bg-v2-background-bg-base px-4 shadow-[var(--v2-elevation-raised)]">
        <div class="min-w-0 flex-1">
          <h1 id="brain-home-title" class="text-[15px] text-v2-text-text-strong [font-weight:530]">
            {language.t("secondBrain.home.title")}
          </h1>
          <p class="truncate text-[12px] text-v2-text-text-faint">{language.t("secondBrain.home.description")}</p>
        </div>
        <ButtonV2 size="small" variant="ghost" icon="workspace" onClick={() => navigate("/workspaces")}>
          {language.t("secondBrain.home.openWorkspace")}
        </ButtonV2>
        <Show when={locations().length > 0}>
          <label class="flex items-center gap-2 text-[12px] text-v2-text-text-muted" for="brain-home-location">
            <span class="hidden sm:inline">{language.t("secondBrain.workspace")}</span>
            <SelectV2
              id="brain-home-location"
              aria-label={language.t("secondBrain.workspace")}
              class="!h-8 !w-auto max-w-56"
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
          </label>
        </Show>
      </header>

      <Show
        when={state.directory}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center rounded-[10px] bg-v2-background-bg-base p-8 shadow-[var(--v2-elevation-raised)]">
            <div class="flex max-w-md flex-col items-center gap-3 text-center">
              <span class="flex size-10 items-center justify-center rounded-[8px] bg-v2-background-bg-layer-02 text-v2-icon-icon-muted">
                <Icon name="workspace-new" size="large" />
              </span>
              <h2 class="text-[15px] text-v2-text-text-strong [font-weight:530]">
                {language.t("secondBrain.home.empty.title")}
              </h2>
              <p class="text-[13px] leading-5 text-v2-text-text-muted">
                {language.t("secondBrain.home.empty.description")}
              </p>
              <ButtonV2 variant="contrast" onClick={() => navigate("/workspaces")}>
                {language.t("secondBrain.home.openWorkspace")}
              </ButtonV2>
            </div>
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
          <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
            <form
              class="rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3"
              onSubmit={(event) => {
                event.preventDefault()
                void startSession()
              }}
            >
              <div class="mb-2 flex items-center justify-between gap-3">
                <label class="block text-[12px] text-v2-text-text-muted" for="brain-home-prompt">
                  {language.t("secondBrain.home.ask")}
                </label>
                <label class="flex items-center gap-2 text-[12px] text-v2-text-text-faint">
                  <span>{language.t("harness.label")}</span>
                  <Suspense fallback={<span class="flex h-7 items-center">{language.t("harness.checking")}</span>}>
                    <SelectV2
                      aria-label={language.t("harness.label")}
                      class="!h-7 !w-auto max-w-[220px]"
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
                </label>
              </div>
              <div class="flex gap-2">
                <TextInputV2
                  id="brain-home-prompt"
                  appearance="large"
                  class="min-w-0 flex-1"
                  value={state.prompt}
                  placeholder={language.t("secondBrain.home.askPlaceholder")}
                  onInput={(event) => setState("prompt", event.currentTarget.value)}
                />
                <ButtonV2
                  type="submit"
                  variant="contrast"
                  disabled={!state.prompt.trim() || state.starting || harnessQuery.isPending}
                >
                  {language.t("secondBrain.home.start")}
                </ButtonV2>
              </div>
              <p class="mt-2 text-[11px] text-v2-text-text-faint">{language.t("secondBrain.home.askNote")}</p>
            </form>

            <Show when={!projects.loading && (projects()?.length ?? 0) === 0}>
              <section class="rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
                <h2 class="text-[14px] text-v2-text-text-base [font-weight:530]">
                  {language.t("secondBrain.home.firstRun.title")}
                </h2>
                <p class="mt-1 text-[12px] leading-5 text-v2-text-text-muted">
                  {language.t("secondBrain.home.firstRun.description")}
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <ButtonV2 variant="contrast" onClick={() => navigate("/projects")}>
                    {language.t("secondBrain.home.firstRun.project")}
                  </ButtonV2>
                  <ButtonV2 variant="outline" onClick={() => navigate("/workspaces")}>
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

            <div class="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <HomePanel
                title={language.t("secondBrain.home.today")}
                action={language.t("secondBrain.home.openCalendar")}
                onAction={() => navigate("/calendar")}
              >
                <Show
                  when={!calendar.loading && todayItems().length > 0}
                  fallback={
                    <p class="px-1 py-5 text-[13px] text-v2-text-text-faint">
                      {calendar.loading ? language.t("common.loading") : language.t("secondBrain.home.todayEmpty")}
                    </p>
                  }
                >
                  <ul class="flex flex-col gap-1">
                    <For each={todayItems()}>
                      {(item) => {
                        const value = item.value
                        const project = () => (value.projectId ? projectNames().get(value.projectId) : undefined)
                        return (
                          <li>
                            <button
                              type="button"
                              class="flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left transition-colors duration-120 hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                              onClick={() =>
                                navigate(
                                  `/calendar?${item.kind === "task" ? "view=tasks&task" : "event"}=${encodeURIComponent(item.value.id)}`,
                                )
                              }
                            >
                              <span
                                classList={{
                                  "flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-v2-background-bg-layer-02 text-v2-icon-icon-muted": true,
                                  "text-v2-text-text-critical": item.kind === "task" && item.overdue,
                                }}
                              >
                                <Icon name={item.kind === "event" ? "status" : "check"} size="small" />
                              </span>
                              <span class="min-w-0 flex-1">
                                <span class="block truncate text-[13px] text-v2-text-text-base [font-weight:470]">
                                  {value.title}
                                </span>
                                <span class="block truncate text-[11px] text-v2-text-text-faint">
                                  {item.kind === "task" && item.overdue
                                    ? language.t("secondBrain.tasks.overdue")
                                    : value.start || language.t(`secondBrain.home.kind.${item.kind}`)}
                                  <Show when={project()}>{(name) => ` · ${name()}`}</Show>
                                </span>
                              </span>
                            </button>
                          </li>
                        )
                      }}
                    </For>
                  </ul>
                </Show>
              </HomePanel>

              <div class="flex min-w-0 flex-col gap-4">
                <HomePanel
                  title={language.t("secondBrain.home.projects")}
                  action={language.t("secondBrain.home.openProjects")}
                  onAction={() => navigate("/projects")}
                >
                  <Show
                    when={!projects.loading && activeProjects().length > 0}
                    fallback={
                      <p class="px-1 py-5 text-[13px] text-v2-text-text-faint">
                        {projects.loading ? language.t("common.loading") : language.t("secondBrain.home.projectsEmpty")}
                      </p>
                    }
                  >
                    <ul class="flex flex-col gap-1">
                      <For each={activeProjects()}>
                        {(project) => (
                          <ProjectRow
                            project={project}
                            onOpen={() => navigate(`/projects?project=${encodeURIComponent(project.id)}`)}
                          />
                        )}
                      </For>
                    </ul>
                  </Show>
                </HomePanel>

                <div class="grid grid-cols-3 gap-2">
                  <Metric
                    loading={projects.loading}
                    value={activeProjects().length}
                    label={language.t("secondBrain.home.metric.projects")}
                  />
                  <Metric
                    loading={calendar.loading}
                    value={outstandingTasks()}
                    label={language.t("secondBrain.home.metric.tasks")}
                  />
                  <Metric value={calendar()?.events.length ?? 0} label={language.t("secondBrain.home.metric.events")} />
                </div>
              </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-2">
              <HomePanel
                title={language.t("secondBrain.home.resume")}
                action={language.t("secondBrain.home.openActivity")}
                onAction={() => navigate("/activity")}
              >
                <Show
                  when={!openCodeSessions.data.loading() && recentSessions().length > 0}
                  fallback={
                    <p class="px-1 py-5 text-[13px] text-v2-text-text-faint">
                      {openCodeSessions.data.loading()
                        ? language.t("common.loading")
                        : language.t("secondBrain.home.resumeEmpty")}
                    </p>
                  }
                >
                  <ul class="flex flex-col gap-1">
                    <For each={recentSessions()}>
                      {(record) => (
                        <SessionRow record={record} onOpen={() => openCodeSessions.session.open(record.session)} />
                      )}
                    </For>
                  </ul>
                </Show>
              </HomePanel>
              <HomePanel
                title={language.t("secondBrain.home.running")}
                action={language.t("secondBrain.home.openActivity")}
                onAction={() => navigate("/activity")}
              >
                <Show
                  when={runningSessions().length > 0}
                  fallback={
                    <p class="px-1 py-5 text-[13px] text-v2-text-text-faint">
                      {language.t("secondBrain.home.runningEmpty")}
                    </p>
                  }
                >
                  <ul class="flex flex-col gap-1">
                    <For each={runningSessions()}>
                      {(record) => (
                        <SessionRow
                          record={record}
                          running
                          onOpen={() => openCodeSessions.session.open(record.session)}
                        />
                      )}
                    </For>
                  </ul>
                </Show>
              </HomePanel>
            </div>
          </div>
        </div>
      </Show>
    </section>
  )
}

function HomePanel(props: {
  title: string
  action: string
  onAction: () => void
  children: import("solid-js").JSX.Element
}) {
  const language = useLanguage()
  return (
    <section class="min-w-0 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3">
      <header class="mb-2 flex h-7 items-center justify-between gap-3 px-1">
        <h2 class="text-[12px] uppercase tracking-[0.06em] text-v2-text-text-faint [font-weight:560]">{props.title}</h2>
        <button
          type="button"
          class="rounded-[5px] px-2 py-1 text-[11px] text-v2-text-text-muted transition-colors duration-120 hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
          onClick={props.onAction}
        >
          {props.action}
        </button>
      </header>
      <Suspense fallback={<p class="px-1 py-5 text-[13px] text-v2-text-text-faint">{language.t("common.loading")}</p>}>
        {props.children}
      </Suspense>
    </section>
  )
}

function ProjectRow(props: { project: ProjectRecord; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        class="w-full rounded-[6px] px-2 py-2 text-left transition-colors duration-120 hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
        onClick={props.onOpen}
      >
        <span class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[13px] text-v2-text-text-base [font-weight:470]">
            {props.project.name}
          </span>
          <span class="shrink-0 text-[11px] tabular-nums text-v2-text-text-faint">
            {props.project.progressPercent}%
          </span>
        </span>
        <span class="mt-1 block h-1 overflow-hidden rounded-full bg-v2-background-bg-layer-03">
          <span
            class="block h-full rounded-full bg-v2-icon-icon-info-base transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${props.project.progressPercent}%` }}
          />
        </span>
        <span class="mt-1.5 block truncate text-[11px] text-v2-text-text-faint">
          {props.project.blocker || props.project.nextMilestone || props.project.outcome}
        </span>
      </button>
    </li>
  )
}

function Metric(props: { value: number; label: string; loading?: boolean }) {
  return (
    <div class="rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-3">
      <div class="text-[17px] tabular-nums text-v2-text-text-strong [font-weight:560]">
        <Suspense fallback="…">
          <Show when={!props.loading} fallback="…">
            {props.value}
          </Show>
        </Suspense>
      </div>
      <div class="mt-0.5 truncate text-[11px] text-v2-text-text-faint">{props.label}</div>
    </div>
  )
}

function SessionRow(props: { record: HomeSessionRecord; running?: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        class="flex min-h-11 w-full items-center gap-3 rounded-[6px] px-2 text-left transition-colors duration-120 hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
        onClick={props.onOpen}
      >
        <span
          classList={{
            "size-2 shrink-0 rounded-full bg-v2-icon-icon-muted": true,
            "bg-v2-icon-icon-accent": props.running,
          }}
        />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] text-v2-text-text-base [font-weight:470]">
            {props.record.session.title}
          </span>
          <span class="block truncate text-[11px] text-v2-text-text-faint">{props.record.projectName}</span>
        </span>
      </button>
    </li>
  )
}
