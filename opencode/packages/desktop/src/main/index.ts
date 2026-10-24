import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, statSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event, WebContents } from "electron"
import { app, BrowserWindow, dialog } from "electron"

import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import contextMenu from "electron-context-menu"

import type { ServerReadyData } from "../preload/types"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL, DEEP_LINK_SCHEME } from "./constants"
import { createDeepLinkQueue, parseDeepLink, type DeepLink } from "./deep-links"
import { redactURL } from "./external-url"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { forwardInitializationFailure } from "./initialization"
import { createGoogleCalendarService } from "./google-calendar"
import { exportDebugLogs, initCrashReporter, initLogging, write as writeLog } from "./logging"
import { createMenu } from "./menu"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import { superviseSidecar } from "./sidecar-supervisor"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrateUserData } from "./user-data-migration"
import { cleanupStoreFiles } from "./store-cleanup"
import { startBackgroundCli } from "./background-cli"
import { nativeT, setNativeTranslations } from "./native-translations"

const APP_NAMES: Record<string, string> = {
  dev: "Tenon Workbench Dev",
  beta: "Tenon Workbench Beta",
  prod: "Tenon Workbench",
}
// Tenon Workbench's own identity. The former `ai.opencode.desktop*` IDs belong to upstream OpenCode
// Desktop; only the dev channel ever shipped under one of them (see migrateUserData below).
const APP_IDS: Record<string, string> = {
  dev: "io.github.torriider97.tenonworkbench.dev",
  beta: "io.github.torriider97.tenonworkbench.beta",
  prod: "io.github.torriider97.tenonworkbench",
}
const LEGACY_DEV_APP_ID = "ai.opencode.desktop.dev"
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const SIDECAR_VERSION = process.env.OPENCODE_SIDECAR_V2 === "1" ? "v2" : "v1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"
// Covers the sidecar's own graceful stop (6 s) before it is killed.
const QUIT_STOP_TIMEOUT = 8_000

let logger: ReturnType<typeof initLogging>
let server: SidecarListener | null = null

const deepLinks = createDeepLinkQueue()
const deepLinkSenders = new WeakSet<WebContents>()

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  const win = getLastFocusedWindow()
  deepLinks.emit(urls, win ? { id: win.webContents.id, send: (next) => sendDeepLinks(win, next) } : undefined)
}

// Any app or web page can open a tenon:// link, so each one is validated here and confirmed
// by the user with the exact folder before the renderer sees it. Links are confirmed one at a time.
let deepLinkConfirmations = Promise.resolve()
function receiveDeepLinks(urls: string[], source: string) {
  for (const value of urls) {
    const link = parseDeepLink(value, (directory) => {
      try {
        return statSync(directory).isDirectory()
      } catch {
        return false
      }
    })
    logger.log("deep link received", { source, url: redactURL(value), accepted: Boolean(link) })
    if (!link) continue
    deepLinkConfirmations = deepLinkConfirmations
      .then(() => confirmDeepLink(link))
      .then((confirmed) => {
        if (confirmed) emitDeepLinks([link.url])
      })
      .catch((error) => logger.warn("deep link confirmation failed", error))
  }
}

async function confirmDeepLink(link: DeepLink) {
  // macOS can deliver open-url before the app is ready, when dialogs cannot open yet.
  await app.whenReady()
  const options = {
    type: "question" as const,
    buttons: [nativeT("secondBrain.desktop.deepLink.open"), nativeT("secondBrain.desktop.deepLink.cancel")],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message:
      link.kind === "open-project"
        ? nativeT("secondBrain.desktop.deepLink.openProject")
        : nativeT("secondBrain.desktop.deepLink.newSession"),
    detail: nativeT(
      link.kind === "open-project"
        ? "secondBrain.desktop.deepLink.openProject.detail"
        : "secondBrain.desktop.deepLink.newSession.detail",
      { path: link.directory },
    ),
  }
  const win = getLastFocusedWindow()
  const result = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
  return result.response === 0
}

function consumeInitialDeepLinks(sender: WebContents) {
  const id = sender.id
  if (!deepLinkSenders.has(sender)) {
    deepLinkSenders.add(sender)
    // Only a full main-frame load drops the renderer's deep-link listener;
    // in-app pushState and hash navigations keep it.
    sender.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) deepLinks.forget(id)
    })
    sender.on("render-process-gone", () => deepLinks.forget(id))
    sender.once("destroyed", () => deepLinks.forget(id))
  }
  return deepLinks.consume(id)
}

async function killSidecar() {
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const channel = app.isPackaged ? CHANNEL : "dev"
  const appId = APP_IDS[channel]
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  const userData = onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId)
  app.setName(APP_NAMES[channel])
  app.setAppUserModelId(appId)
  app.setPath("userData", userData)
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  // The lock is keyed by userData. A second instance only hands its argv (deep links) to the first
  // instance, so it quits before migrating data, opening logs or starting the crash reporter.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  // Beta and prod never shipped under the old IDs, so their old folders are upstream's and stay unread.
  const userDataMigration = (() => {
    if (onboardingTestRoot) return
    try {
      return migrateUserData(channel === "dev" ? join(app.getPath("appData"), LEGACY_DEV_APP_ID) : undefined, userData)
    } catch (error) {
      // No marker is written, so the copy is retried on the next start.
      return error instanceof Error ? error : new Error(String(error))
    }
  })()
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  if (userDataMigration instanceof Error)
    logger.error("user data migration failed; retrying on next start", { error: userDataMigration.message })
  else if (userDataMigration) logger.log("user data migration", { result: userDataMigration })
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  const stopSidecars = async () => {
    await killSidecar()
    wslServers.stopAll()
  }
  const relaunch = () => {
    setAppQuitting()
    void stopSidecars().finally(() => {
      app.relaunch()
      app.quit()
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  // Probes the login shell in the background; the sidecar env waits for it below.
  const shellEnv = preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith(`${DEEP_LINK_SCHEME}://`))
    if (urls.length) receiveDeepLinks(urls, "second-instance")
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    receiveDeepLinks([url], "open-url")
  })

  // The first quit waits (bounded) for the sidecar to stop, then quits again.
  let quitStop: Promise<void> | undefined
  let quitStopped = false
  app.on("before-quit", (event) => {
    setAppQuitting()
    if (quitStopped || (!quitStop && !server)) return
    event.preventDefault()
    quitStop ??= Promise.race([stopSidecars(), new Promise<void>((resolve) => setTimeout(resolve, QUIT_STOP_TIMEOUT))])
      .catch((error) => logger.error("failed to stop sidecars before quit", error))
      .finally(() => {
        quitStopped = true
        app.quit()
      })
  })

  app.on("will-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      void stopSidecars().finally(() => app.quit())
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())

  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  registerRendererProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(stopSidecars)
  const googleCalendar = createGoogleCalendarService()
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater, true),
    relaunch,
  }
  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks,
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater,
    googleCalendar,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) createMenu(menuDeps)
    },
  })
  registerWslIpcHandlers(wslServers)
  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { version: SIDECAR_VERSION })

    const env = yield* Effect.promise(() => shellEnv)
    ensureLoopbackNoProxy()
    useEnvProxy()

    if (SIDECAR_VERSION === "v2") {
      logger.log("spawning v2 sidecar")
      const sidecar = yield* Effect.promise(() => startBackgroundCli(logger, env?.XDG_STATE_HOME))
      yield* Deferred.succeed(serverReady, {
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })

      if (process.platform === "win32") {
        void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
      }

      logger.log("loading task finished")
      return
    }

    const port = yield* Effect.gen(function* () {
      const fromEnv = process.env.OPENCODE_PORT
      if (fromEnv) {
        const parsed = Number.parseInt(fromEnv, 10)
        if (!Number.isNaN(parsed)) return parsed
      }

      const res = yield* Deferred.make<number, unknown>()
      const socket = createServer()
      socket.on("error", (e) => Deferred.failSync(res, () => e))
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address()
        if (typeof address !== "object" || !address) {
          socket.close()
          Deferred.failSync(res, () => new Error("Failed to get port"))
          return
        }
        const port = address.port
        socket.close(() => Effect.runSync(Deferred.succeed(res, port)))
      })

      return yield* Deferred.await(res)
    })
    const hostname = "127.0.0.1"
    const url = `http://${hostname}:${port}`
    const password = randomUUID()

    logger.log("spawning sidecar", { url })
    // Restarts after a crash reuse the port and password, so renderers reconnect to the same URL.
    const sidecar = superviseSidecar({
      spawn: () =>
        spawnLocalServer(hostname, port, password, {
          userDataPath: app.getPath("userData"),
          onStdout: (message) => writeLog("server", "stdout", { message }),
          onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
          onExit: (code) => writeLog("utility", "sidecar exited", { code }, "warn"),
        }),
      log: (message, meta) => writeLog("utility", message, meta, "warn"),
    })
    // Set before the start is awaited, so quitting during startup stops the child.
    server = sidecar
    yield* Effect.promise(() => sidecar.initial.ready)

    // Windows are already open; renderers keep their splash until the server answers (or this times out).
    yield* Effect.tryPromise({ try: (signal) => sidecar.initial.waitHealthy(signal), catch: (error) => error }).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", String(e))
        }),
      ),
    )
    yield* Deferred.succeed(serverReady, {
      url,
      username: "opencode",
      password,
    })

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  // Windows open while the server starts; the renderer shows its splash until awaitInitialization resolves.
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    restoreMainWindows()
  })

  const windows = restoreMainWindows()
  if (windows.length) createMenu(menuDeps)

  const loaded = yield* Fiber.await(loadingTask)
  if (Exit.isFailure(loaded)) logger.error("loading task failed", Cause.pretty(loaded.cause))
})

Effect.runFork(main)
