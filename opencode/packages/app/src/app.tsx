import "@/index.css"
import * as Sentry from "@sentry/solid"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { File } from "@opencode-ai/session-ui/file"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router, useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import {
  type Component,
  createEffect,
  createMemo,
  createRenderEffect,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  lazy,
  onCleanup,
  type ParentProps,
  Show,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider, useCommand, type CommandOption } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { ServerSDKProvider } from "@/context/server-sdk"
import { HarnessUpdateNotifier } from "@/components/harness-update-notifier"
import { ServerSyncProvider } from "@/context/server-sync"
import { GlobalProvider, useGlobal } from "@/context/global"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { DraftsProvider, draftHref, NEW_THREAD_PATH, useDrafts, type Draft } from "@/context/drafts"
import { SDKProvider } from "@/context/sdk"
import { WslServersProvider } from "@/wsl/context"
import { DirectoryDataProvider } from "@/pages/directory-layout"
import NewLayout from "@/pages/layout-new"
import { ErrorPage } from "./pages/error"
import { useCheckServerHealth } from "./utils/server-health"
import { requireServerKey, sessionHref } from "./utils/session-route"
import { decode64 } from "./utils/base64"

import { TargetSessionRouteContent } from "@/pages/session"

const NewSession = lazy(() => import("@/pages/new-session"))
const NotesPage = lazy(() => import("@/pages/notes"))
const CalendarPage = lazy(() => import("@/pages/calendar"))
const ProjectsPage = lazy(() => import("@/pages/projects"))
const BrainHomePage = lazy(() => import("@/pages/brain-home"))
const ActivityPage = lazy(() => import("@/pages/activity"))

function TargetServerRoute(props: ParentProps) {
  const params = useParams<{ serverKey: string; id: string }>()
  const global = useGlobal()
  const conn = createMemo(() => {
    const key = requireServerKey(params.serverKey)
    return global.servers.list().find((item) => ServerConnection.key(item) === key)
  })

  return (
    // Owns the server-identity remount. Session changes must NOT remount this
    // subtree (SessionRouteErrorBoundary resets and createSessionLineage
    // re-resolves reactively instead); both rely on this key for server changes.
    <Show when={requireServerKey(params.serverKey)} keyed>
      <ServerSDKProvider server={conn}>
        <ServerSyncProvider server={conn}>{props.children}</ServerSyncProvider>
      </ServerSDKProvider>
    </Show>
  )
}

const TargetSessionRoute = () => (
  <TargetServerRoute>
    <TargetSessionRouteContent />
  </TargetServerRoute>
)

// Wraps the non-draft routes. They are gated on (and keyed to) the globally selected
// server via ServerKey, then provide the server-scoped shell for that server.
function SelectedServerProviders(props: ParentProps) {
  return (
    <ServerKey>
      <ServerSDKProvider>
        <ServerSyncProvider>{props.children}</ServerSyncProvider>
      </ServerSDKProvider>
    </ServerKey>
  )
}

function DraftRoute() {
  const [search] = useSearchParams<{ draftId?: string }>()
  const drafts = useDrafts()
  return (
    <Show when={drafts.ready()}>
      <Show when={drafts.get(search.draftId)} keyed fallback={<Navigate href="/" />}>
        {(draft) => <ResolvedDraftRoute draft={draft} />}
      </Show>
    </Show>
  )
}

function ResolvedDraftRoute(props: { draft: Draft }) {
  const global = useGlobal()
  const conn = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === props.draft.server))
  const directory = () => props.draft.directory
  const serverKey = () => props.draft.server

  return (
    <Show when={`${props.draft.server}\0${props.draft.directory}`} keyed>
      <ServerSDKProvider server={conn}>
        <ServerSyncProvider server={conn}>
          <ModelsProvider directory={directory}>
            <SDKProvider directory={directory}>
              <DirectoryDataProvider directory={directory} server={serverKey}>
                <DraftProviders>
                  <NewSession />
                </DraftProviders>
              </DirectoryDataProvider>
            </SDKProvider>
          </ModelsProvider>
        </ServerSyncProvider>
      </ServerSDKProvider>
    </Show>
  )
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return (
    <I18nProvider
      value={{ locale: language.intl, layoutLocale: language.layoutLocale, t: language.t, plural: language.plural }}
    >
      {props.children}
    </I18nProvider>
  )
}

declare global {
  interface OpenCodeDesktopAPI {
    setTitlebar: (theme: { mode: "light" | "dark"; scheme?: "system" | "light" | "dark" }) => Promise<void>
    exportDebugLogs: () => Promise<string>
  }
  interface Window {
    __OPENCODE__?: {
      deepLinks?: string[]
    }
    api: OpenCodeDesktopAPI
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function BodyDesignClass() {
  createRenderEffect(() => {
    if (typeof document === "undefined") return
    document.body.toggleAttribute("data-new-layout", true)
    document.body.classList.add("font-(family-name:--font-family-text)", "text-[13px]", "font-[440]")
  })

  return null
}

// Server-agnostic providers shared across every route. These live in the shared
// shell (router root) so they stay mounted regardless of the active server/route.
function SharedProviders(props: ParentProps) {
  return (
    <>
      <BodyDesignClass />
      <CommandProvider>
        <DesktopCommands />
        {props.children}
      </CommandProvider>
    </>
  )
}

function DesktopCommands() {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()

  command.register("desktop", () => {
    const commands: CommandOption[] = []
    if (platform.platform === "desktop" && platform.exportDebugLogs) {
      commands.push({
        id: "logs.export",
        title: language.t("command.logs.export"),
        category: language.t("command.category.settings"),
        onSelect: () => {
          void platform.exportDebugLogs?.()
        },
      })
    }
    return commands
  })

  return null
}

// Server-scoped providers for the app shell.
type ServerScopedShellProps = ParentProps<{
  directory?: () => string | undefined
  serverScoped?: JSX.Element
}>

function ServerScopedProviders(props: ServerScopedShellProps) {
  return (
    <LayoutProvider>
      {props.serverScoped}
      <HarnessUpdateNotifier />
      <ModelsProvider directory={props.directory}>{props.children}</ModelsProvider>
    </LayoutProvider>
  )
}

function NewAppLayout(props: ParentProps<{ serverScoped?: JSX.Element }>) {
  return (
    <SelectedServerProviders>
      <ServerScopedProviders serverScoped={props.serverScoped}>
        <NewLayout>{props.children}</NewLayout>
      </ServerScopedProviders>
    </SelectedServerProviders>
  )
}

// The draft page only renders the prompt composer, so it drops TerminalProvider.
// FileProvider and CommentsProvider stay because PromptInput uses file search and comment context.
function DraftProviders(props: ParentProps) {
  return (
    <FileProvider>
      <PromptProvider>
        <CommentsProvider>{props.children}</CommentsProvider>
      </PromptProvider>
    </FileProvider>
  )
}

export function AppBaseProviders(
  props: ParentProps<{
    locale?: Locale
    onNativeTranslations?: Parameters<typeof LanguageProvider>[0]["onNativeTranslations"]
  }>,
) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode, scheme) => {
          void window.api?.setTitlebar?.({ mode, scheme })
        }}
      >
        <LanguageProvider locale={props.locale} onNativeTranslations={props.onNativeTranslations}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                Sentry.captureException(error)
                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <WslServersProvider>
                  <DialogProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </DialogProvider>
                </WslServersProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean; startup?: Promise<void> }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )
  const checking = createMemo(
    () => checkMode() === "blocking" && ["unresolved", "pending"].includes(startupHealthCheck.state),
  )
  const [startup] = createResource(async () => {
    if (!props.startup) return true
    await props.startup.catch((error) => {
      console.error("[startup] startup gate failed", error)
    })
    return true
  })
  const startupChecking = createMemo(
    () => startupHealthCheck.latest === true && ["unresolved", "pending"].includes(startup.state),
  )
  const loading = createMemo(() => checking() || startupChecking())

  return (
    <>
      <Show when={!checking()}>
        <Show
          when={startupHealthCheck.latest}
          fallback={
            <ConnectionError
              onRetry={() => {
                if (checkMode() === "background") void healthCheckActions.refetch()
              }}
              onServerSelected={(key) => {
                setCheckMode("blocking")
                server.setActive(key)
                void healthCheckActions.refetch()
              }}
            />
          }
        >
          {props.children}
        </Show>
      </Show>
      <Show when={loading()}>
        <div class="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-v2-background-bg-deep">
          <Splash class="size-16 opacity-50 animate-pulse" />
        </div>
      </Show>
    </>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="flex h-dvh w-screen overflow-y-auto bg-v2-background-bg-deep px-4 py-10">
      <main class="m-auto flex w-full max-w-[440px] flex-col items-center gap-5 text-center">
        <span class="flex size-16 items-center justify-center rounded-[16px] bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
            <path d="M12 5v13" />
          </svg>
        </span>
        <div class="flex flex-col gap-1.5">
          <h1 class="text-[20px] text-v2-text-text-base [font-weight:560]">
            {unreachable()[0]}
            <span class="font-mono text-[18px]">{name()}</span>
            {unreachable()[1]}
          </h1>
          <p role="status" class="inline-flex items-center justify-center gap-2 text-[13px] text-v2-text-text-muted">
            <LoaderV2 class="text-v2-icon-icon-accent" />
            {language.t("app.server.retrying")}
          </p>
        </div>
        <Show when={others().length > 0}>
          <section aria-labelledby="connection-other-servers" class="flex w-full flex-col gap-1 text-left">
            <h2
              id="connection-other-servers"
              class="flex h-8 items-center pl-3 text-[13px] text-v2-text-text-muted [font-weight:530]"
            >
              {language.t("app.server.otherServers")}
            </h2>
            <div class="flex flex-col gap-0.5 overflow-hidden rounded-[24px]">
              <For each={others()}>
                {(conn) => {
                  const key = ServerConnection.key(conn)
                  return (
                    <button
                      type="button"
                      class="flex min-h-14 w-full items-center gap-3 bg-v2-background-bg-layer-01 px-5 py-2 text-left transition-[background-color,border-radius] duration-300 ease-standard hover:bg-v2-background-bg-layer-02 active:rounded-[16px] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"
                      onClick={() => props.onServerSelected?.(key)}
                    >
                      <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:530]">
                        {serverName(conn)}
                      </span>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        class="shrink-0 text-v2-icon-icon-muted"
                      >
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  )
                }}
              </For>
            </div>
          </section>
        </Show>
      </main>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
  startup?: Promise<void>
  serverScoped?: JSX.Element
}) {
  // The visual new layout lives in the router root so it remains mounted across
  // route changes. Draft and session routes override only their server-bound data
  // providers beneath it.
  // The shell reuses AppBaseProviders' QueryClient, the one GlobalProvider's server sync
  // writes to, so live session events reach the sidebar and Home queries.
  const ServerShell = (shellProps: ParentProps) => (
    <SharedProviders>
      {props.children}
      {shellProps.children}
    </SharedProviders>
  )

  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      canonicalLocalServer={props.canonicalLocalServer}
      servers={props.servers}
    >
      <GlobalProvider>
        <SettingsProvider>
          <ConnectionGate disableHealthCheck={props.disableHealthCheck} startup={props.startup}>
            <Dynamic
              component={props.router ?? Router}
              root={(routerProps) => (
                <DraftsProvider>
                  <PermissionProvider>
                    <NotificationProvider>
                      <ServerShell>
                        <NewAppLayout serverScoped={props.serverScoped}>{routerProps.children}</NewAppLayout>
                      </ServerShell>
                    </NotificationProvider>
                  </PermissionProvider>
                </DraftsProvider>
              )}
            >
              <Routes />
            </Dynamic>
          </ConnectionGate>
        </SettingsProvider>
      </GlobalProvider>
    </ServerProvider>
  )
}

function Routes() {
  return (
    <>
      <Route path="/" component={BrainHomePage} />
      <Route path="/brain" component={() => <Navigate href="/" />} />
      <Route path="/workspaces" component={() => <Navigate href="/" />} />
      <Route path="/notes" component={NotesPage} />
      <Route path="/calendar" component={CalendarPage} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/activity" component={ActivityPage} />
      <Route path="/server/:serverKey/session/:id" component={TargetSessionRoute} />
      <Route path={NEW_THREAD_PATH} component={DraftRoute} />
      <Route path="/new-session" component={LegacyDraftRedirect} />
      <Route path="/:dir/session/:id" component={LegacySessionRedirect} />
      <Route path="/:dir/session" component={LegacyNewSessionRedirect} />
      <Route path="*" component={() => <Navigate href="/" />} />
    </>
  )
}

// Old draft URLs (/new-session?draftId=…) from before the sidebar shell.
function LegacyDraftRedirect() {
  const [search] = useSearchParams<{ draftId?: string }>()
  return <Navigate href={search.draftId ? draftHref({ draftID: search.draftId }) : "/"} />
}

// Old directory-scoped session URLs (/:dir/session/:id) open on the selected server.
function LegacySessionRedirect() {
  const server = useServer()
  const params = useParams<{ id: string }>()
  return <Navigate href={sessionHref(server.key, params.id)} />
}

// Old new-session URLs (/:dir/session) open a draft in that folder.
function LegacyNewSessionRedirect() {
  const server = useServer()
  const drafts = useDrafts()
  const navigate = useNavigate()
  const params = useParams<{ dir: string }>()
  createEffect(() => {
    if (!drafts.ready()) return
    const directory = decode64(params.dir)
    if (!directory) return navigate("/", { replace: true })
    void drafts.create({ server: server.key, directory })
  })
  return null
}
