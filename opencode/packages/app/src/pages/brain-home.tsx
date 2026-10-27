import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
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
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogHarnessSetup } from "@/components/settings-v2/harness-setup"
import { PageFrame, PageSection, pageRowClass } from "@/components/page"
import { localDateKey } from "@/features/second-brain/calendar-domain"
import { listProjects, readCalendar, type CalendarEvent, type PlannerTask } from "@/features/second-brain/client"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { Harness } from "@opencode-ai/schema/harness"
import {
  harnessAssistantDirectory,
  listHarnessSetup,
  listHarnessesRemembered,
  rememberedHarnesses,
} from "@/utils/server"
import {
  PromptInputHarnessControls,
  type PromptInputHarnessController,
} from "@/components/prompt-input/harness-controls"
import { defaultModel } from "@/components/prompt-input/harness-controller"
import { useSettings, withVisibleModels } from "@/context/settings"

type TodayItem = { kind: "event"; value: CalendarEvent } | { kind: "task"; value: PlannerTask; overdue: boolean }

export default function BrainHomePage() {
  const language = useLanguage()
  const settings = useSettings()
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
    prompt: "",
    harnessInstanceID: Harness.OpenCode as Harness.InstanceID,
    harnessModel: undefined as Harness.ModelSelection | undefined,
    starting: false,
  })
  const client = (directory: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory },
  })

  // The sidebar workspace switcher owns this choice; the page only follows it.
  const directory = () => layout.home.workspace() ?? ""

  // First run: offer the built-in agent setup once, unless every built-in agent is already installed and signed in.
  // It runs in the server's non-project assistant folder, so a new user needs no workspace for it.
  const dialog = useDialog()
  createEffect(() => {
    if (!settings.ready() || settings.harnesses.setupPrompted()) return
    settings.harnesses.setSetupPrompted()
    const harnessServer = { server: serverSDK().server.http, fetch: platform.fetch }
    void listHarnessSetup(harnessServer, "")
      .then(async (statuses) => {
        if (statuses.every((item) => item.installed && item.auth !== "signed-out")) return
        const target = await harnessAssistantDirectory(harnessServer, "")
        void dialog.show(() => <DialogHarnessSetup directory={target} />)
      })
      .catch(() => undefined)
  })

  const [projects] = createResource(
    () => directory() || undefined,
    (directory) => listProjects(client(directory)),
  )
  const [calendar] = createResource(
    () => directory() || undefined,
    (directory) => readCalendar(client(directory)),
  )
  const harnessQuery = useQuery(() => ({
    queryKey: ["home", "harnesses", server.key, directory()],
    enabled: !!directory(),
    queryFn: () => listHarnessesRemembered({ server: serverSDK().server.http, fetch: platform.fetch }, directory()),
    // After the cached query is collected, the last good list keeps the picker usable while it reloads.
    placeholderData: () => rememberedHarnesses(serverSDK().server.http.url, directory()),
    staleTime: 30_000,
    refetchOnMount: true,
    retry: false,
  }))
  // Models hidden in Settings never reach the picker or the default-model choice, as in the thread composer.
  // Reading `data` suspends, so callers outside the controls' Suspense boundary check `isPending` first.
  const harnesses = () =>
    harnessQuery.data?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    )
  const selectHarness = (instanceID: Harness.InstanceID) => {
    const next = harnesses()?.find((instance) => instance.id === instanceID)
    setState({ harnessInstanceID: instanceID, harnessModel: next ? defaultModel(next) : undefined })
  }
  // Fall back to an available harness, and keep the model valid for the selected one.
  createEffect(() => {
    if (harnessQuery.isPending) return
    const available = harnesses()
    if (!available) return
    const current = available.find((instance) => instance.id === state.harnessInstanceID)
    if (current?.status !== "available") {
      const fallback = available.find((instance) => instance.status === "available")
      if (fallback) selectHarness(fallback.id)
      return
    }
    if (current.models.some((model) => model.id === state.harnessModel?.id)) return
    setState("harnessModel", defaultModel(current))
  })
  const harness: PromptInputHarnessController = {
    instances: harnesses,
    // Only the first load blocks the picker; a stale list stays usable while it refreshes.
    loading: () => harnessQuery.isPending,
    // Opening the picker refetches once stale; the app's queries don't refetch on window focus.
    revalidate: () => void (harnessQuery.isStale && harnessQuery.refetch()),
    current: () => state.harnessInstanceID,
    select: selectHarness,
    model: {
      current: () => state.harnessModel,
      set: (model) => setState("harnessModel", model),
    },
  }
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

  // The built-in agent needs no check, so only another harness waits for the list. The thread page
  // sends once its own list has loaded, and keeps the prompt if the harness turns out unavailable.
  const waitingForHarness = () => harnessQuery.isPending && state.harnessInstanceID !== Harness.OpenCode
  const startSession = async () => {
    const prompt = state.prompt.trim()
    if (!prompt || !directory() || state.starting || waitingForHarness()) return
    setState("starting", true)
    try {
      // The draft page sends the prompt as soon as its composer is ready.
      await drafts.create({ server: server.key, directory: directory() }, prompt, undefined, state.harnessInstanceID, {
        send: true,
        harnessModel: state.harnessModel,
      })
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
        <span class="flex-1" />
        <TooltipV2 value={language.t("secondBrain.home.openWorkspace")} placement="bottom">
          <IconButtonV2
            variant="ghost"
            size="large"
            class="!size-9"
            aria-label={language.t("secondBrain.home.openWorkspace")}
            icon={<Icon name="folder-add-left" />}
            onClick={() => command.trigger("project.open")}
          />
        </TooltipV2>
      </div>

      <Show
        when={directory()}
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
            <div class="flex min-w-0 flex-wrap items-center gap-1">
              {/* The thread composer's controls: harness, then model and reasoning for external agents.
                  The harness query suspends while it loads; this boundary keeps the rest of Home on screen. */}
              <Suspense
                fallback={
                  <span class="flex h-8 items-center px-2 text-[12px] text-v2-text-text-faint">
                    {language.t("harness.checking")}
                  </span>
                }
              >
                <PromptInputHarnessControls controller={harness} />
              </Suspense>
              <span class="flex-1" />
              <IconButtonV2
                type="submit"
                variant="contrast"
                size="large"
                class="!size-10"
                aria-label={language.t("secondBrain.home.start")}
                icon={<Icon name="arrow-up" />}
                disabled={!state.prompt.trim() || state.starting || waitingForHarness()}
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
