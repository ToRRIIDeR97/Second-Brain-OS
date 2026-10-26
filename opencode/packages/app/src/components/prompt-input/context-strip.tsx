import "./context-strip.css"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { useQuery } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { ProgressCircleV2 } from "@opencode-ai/ui/v2/progress-circle-v2"
import { For, Show, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { openSessionContext } from "@/components/session-context-usage"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { getSessionContext } from "@/components/session/session-context-metrics"
import { getSessionUsage } from "@/components/session/session-usage"
import { projectThreadsQueryKey } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { listProjectThreads, readInstructions } from "@/features/second-brain/client"
import { useProviders } from "@/hooks/use-providers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { contextTokenRows, instructionsLabel, threadProject } from "./context-strip-model"

const HOVER_OPEN_MS = 400
const HOVER_CLOSE_MS = 200

const TOKEN_LABEL = {
  input: "secondBrain.sessionTab.input",
  cacheRead: "secondBrain.contextStrip.cacheRead",
  cacheWrite: "secondBrain.contextStrip.cacheWrite",
  output: "secondBrain.sessionTab.output",
  reasoning: "context.stats.reasoningTokens",
} as const

/**
 * A slim strip on the composer's top edge: the thread's Project, Git branch, harness, changed files and
 * context use. Hovering or clicking it opens the details. Shown only in a thread; items without data hide.
 */
export function ComposerContextStrip(props: {
  /** Name of the thread's harness instance. */
  harness?: string
  /** Selected agent; passed only for the built-in loop, which is the one that has agents. */
  agent?: string
  /** The Review panel's changed-file count. */
  files?: number
}) {
  const sync = useSync()
  const sdk = useSDK()
  const layout = useLayout()
  const server = useServer()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const providers = useProviders(() => sdk().directory)
  const { params, tabs, view } = useSessionLayout()

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))
  const messages = createMemo(() => (params.id ? (sync().data.message[params.id] ?? []) : []))
  const context = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const cost = createMemo(() => getSessionUsage(messages()).cost)
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))

  const workspace = layout.home.workspace
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })
  // The sidebar's own query, so both read one cached Project list and stay in step.
  const projectsQuery = useQuery(() => ({
    queryKey: projectThreadsQueryKey(server.key, workspace()),
    enabled: !!workspace(),
    queryFn: () => listProjectThreads(client(workspace())),
    staleTime: 30_000,
    retry: false,
  }))
  const project = createMemo(() => {
    // Wait for the list so a Project thread does not flash "General"; reading `data` before then would suspend.
    if (workspace() && projectsQuery.isPending) return
    return threadProject({
      entries: projectsQuery.isSuccess && Array.isArray(projectsQuery.data) ? projectsQuery.data : [],
      workspaceDirectory: workspace(),
      workspaces: layout.projects.list(),
      directory: info()?.directory ?? sdk().directory,
    })
  })
  const projectName = () => {
    const value = project()
    if (!value) return
    if (value.kind === "project") return value.entry.project.name
    if (value.kind === "general") return language.t("secondBrain.sidebar.workspaceThreads")
    return value.name
  }
  const record = () => {
    const value = project()
    return value?.kind === "project" ? value.entry.project : undefined
  }

  const branch = () => (sync().project?.vcs === "git" ? sync().data.vcs?.branch : undefined)
  const harness = () => [props.harness, props.agent].filter(Boolean).join(" · ")
  const files = () => (props.files && props.files > 0 ? props.files : undefined)
  const percent = () => context()?.usage ?? undefined
  const filesLabel = () => {
    const count = files()
    if (!count) return
    return language.plural("secondBrain.contextStrip.files", count, { count: count.toLocaleString(language.intl()) })
  }
  // The strip is one button, so its name carries what the items show.
  const label = () =>
    language.t("secondBrain.contextStrip.label", {
      summary: new Intl.ListFormat(language.intl(), { style: "narrow", type: "unit" }).format(
        [
          projectName(),
          branch(),
          harness(),
          filesLabel(),
          percent() === undefined ? "" : formatter().percent(percent()),
        ].filter((item): item is string => !!item),
      ),
    })

  const [state, setState] = createStore({ open: false, pinned: false })
  let timer: ReturnType<typeof setTimeout> | undefined
  let pinOnToggle = false
  let restoreFocus = false
  const cancel = () => clearTimeout(timer)
  onCleanup(cancel)
  // Hover opens a peek that leaves focus in the composer; a click or key press pins it open.
  const hover = (event: PointerEvent, inside: boolean) => {
    if (event.pointerType !== "mouse") return
    cancel()
    if (inside && !state.open) timer = setTimeout(() => setState({ open: true, pinned: false }), HOVER_OPEN_MS)
    if (!inside && state.open && !state.pinned)
      timer = setTimeout(() => setState({ open: false, pinned: false }), HOVER_CLOSE_MS)
  }
  const onOpenChange = (open: boolean) => {
    cancel()
    if (!open && pinOnToggle) {
      pinOnToggle = false
      setState("pinned", true)
      return
    }
    pinOnToggle = false
    restoreFocus = !open && state.pinned
    setState({ open, pinned: open })
  }

  const instructionsTarget = createMemo(() => {
    const value = project()
    const root = workspace()
    if (value?.kind === "project") return { directory: value.entry.threadDirectory, fallback: root }
    if (value?.kind === "general" && root) return { directory: root, fallback: undefined }
  })
  // A Project's own AGENTS.md replaces the workspace default; read only while the details are open.
  const instructionsQuery = useQuery(() => ({
    queryKey: [
      "second-brain",
      "instructions-in-effect",
      server.key,
      instructionsTarget()?.directory ?? "",
      instructionsTarget()?.fallback ?? "",
    ] as const,
    enabled: state.open && !!instructionsTarget(),
    queryFn: async () => {
      const target = instructionsTarget()!
      const own = await readInstructions(client(target.directory))
      if (own.content !== null) return own.path
      if (!target.fallback || target.fallback === target.directory) return null
      const fallback = await readInstructions(client(target.fallback))
      return fallback.content === null ? null : fallback.path
    },
    retry: false,
  }))
  const instructions = () =>
    instructionsQuery.isSuccess && instructionsQuery.data
      ? instructionsLabel(instructionsQuery.data, workspace())
      : undefined

  const visible = () => !!params.id && !!(projectName() || branch() || harness() || files() || context())
  const viewContext = () => {
    onOpenChange(false)
    openSessionContext({ view: view(), layout, tabs: tabs() })
  }

  return (
    <Show when={visible()}>
      <div
        data-component="context-strip"
        class="w-full overflow-hidden rounded-t-[24px] bg-v2-background-bg-layer-01"
        style={{ "margin-bottom": "-0.875rem", "padding-bottom": "0.875rem" }}
      >
        <Kobalte open={state.open} onOpenChange={onOpenChange} placement="top-end" gutter={6} modal={false}>
          <Kobalte.Trigger
            as="button"
            type="button"
            data-action="context-strip"
            aria-label={label()}
            class="flex h-8 w-full min-w-0 items-center gap-3 rounded-t-[24px] px-5 text-[12px] leading-4 text-v2-text-text-muted transition-colors duration-150 ease-standard hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
            onClick={() => (pinOnToggle = state.open && !state.pinned)}
            onPointerEnter={(event: PointerEvent) => hover(event, true)}
            onPointerLeave={(event: PointerEvent) => hover(event, false)}
          >
            <Show when={projectName()}>
              {(name) => (
                <span data-slot="context-strip-project" class="flex min-w-0 shrink items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    class="size-1.5 shrink-0 rounded-full"
                    classList={{
                      "bg-v2-state-fg-success": !!record() && !record()!.blocker,
                      "bg-v2-state-fg-danger": !!record()?.blocker,
                      "bg-v2-icon-icon-muted": !record(),
                    }}
                  />
                  <span class="min-w-0 truncate text-v2-text-text-base [font-weight:530]" title={name()}>
                    {name()}
                  </span>
                </span>
              )}
            </Show>
            <Show when={branch()}>
              {(value) => (
                <StripItem slot="context-strip-branch" icon="branch">
                  {value()}
                </StripItem>
              )}
            </Show>
            <Show when={harness()}>
              {(value) => (
                <StripItem slot="context-strip-harness" icon="status">
                  {value()}
                </StripItem>
              )}
            </Show>
            <Show when={filesLabel()}>
              {(value) => (
                <StripItem slot="context-strip-files" icon="review">
                  {value()}
                </StripItem>
              )}
            </Show>
            <Show when={percent() !== undefined}>
              <span data-slot="context-strip-usage" class="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
                <ProgressCircleV2 percentage={percent()!} size={12} />
                {formatter().percent(percent())}
              </span>
            </Show>
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              data-component="context-strip-popover"
              class="flex w-[300px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-[20px] bg-v2-background-bg-base p-4 text-[12px] leading-4 text-v2-text-text-muted shadow-[var(--v2-elevation-floating)]"
              onOpenAutoFocus={(event: Event) => !state.pinned && event.preventDefault()}
              onCloseAutoFocus={(event: Event) => !restoreFocus && event.preventDefault()}
              onPointerEnter={(event: PointerEvent) => hover(event, true)}
              onPointerLeave={(event: PointerEvent) => hover(event, false)}
            >
              <Show when={context()}>
                {(value) => (
                  <Section title={language.t("secondBrain.sessionTab.contextWindow")}>
                    <Row
                      label={language.t("secondBrain.sessionTab.contextShare")}
                      value={
                        value().limit
                          ? language.t("secondBrain.sessionTab.contextUsed", {
                              used: formatter().number(value().total),
                              limit: formatter().number(value().limit),
                            })
                          : language.t("secondBrain.contextStrip.tokens", { count: formatter().number(value().total) })
                      }
                    />
                    <Row label={language.t("context.stats.model")} value={value().modelLabel} />
                    <For each={contextTokenRows(value().message.tokens)}>
                      {(row) => <Row label={language.t(TOKEN_LABEL[row.key])} value={formatter().number(row.value)} />}
                    </For>
                    <Show when={cost()}>
                      {(amount) => (
                        <Row label={language.t("secondBrain.sessionTab.cost")} value={usd().format(amount())} />
                      )}
                    </Show>
                  </Section>
                )}
              </Show>
              <Show when={projectName()}>
                {(name) => (
                  <Section title={name()}>
                    <Show when={record()}>
                      {(item) => (
                        <>
                          <Row
                            label={language.t("secondBrain.contextStrip.status")}
                            value={language.t(`secondBrain.projects.filter.${item().status}`)}
                          />
                          <Row
                            label={language.t("secondBrain.projects.progress")}
                            value={`${item().progressPercent}%`}
                          />
                          <Show when={item().nextMilestone}>
                            {(milestone) => (
                              <Row label={language.t("secondBrain.projects.nextMilestone")} value={milestone()} wrap />
                            )}
                          </Show>
                          <Show when={item().blocker}>
                            {(blocker) => (
                              <Row label={language.t("secondBrain.projects.blocker")} value={blocker()} wrap critical />
                            )}
                          </Show>
                        </>
                      )}
                    </Show>
                    <Show when={instructions()}>
                      {(path) => (
                        <Row label={language.t("secondBrain.contextStrip.instructions")} value={path()} wrap />
                      )}
                    </Show>
                  </Section>
                )}
              </Show>
              <ButtonV2 variant="ghost-muted" size="small" class="self-start" onClick={viewContext}>
                {language.t("context.usage.view")}
              </ButtonV2>
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </div>
    </Show>
  )
}

function StripItem(props: { slot: string; icon: "branch" | "status" | "review"; children: string }) {
  return (
    <span data-slot={props.slot} class="flex min-w-0 max-w-[180px] shrink items-center gap-1">
      <Icon name={props.icon} size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 truncate" title={props.children}>
        {props.children}
      </span>
    </span>
  )
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-1.5">
      <h3 class="text-[12px] text-v2-text-text-base [font-weight:530]">{props.title}</h3>
      {props.children}
    </section>
  )
}

function Row(props: { label: string; value: string; wrap?: boolean; critical?: boolean }) {
  return (
    <div class="flex min-w-0 items-baseline gap-4">
      <span class="shrink-0">{props.label}</span>
      <span
        class="ml-auto min-w-0 text-right"
        classList={{
          truncate: !props.wrap,
          "break-words": !!props.wrap,
          "text-v2-text-text-base": !props.critical,
          "text-v2-text-text-critical": !!props.critical,
        }}
      >
        {props.value}
      </span>
    </div>
  )
}
