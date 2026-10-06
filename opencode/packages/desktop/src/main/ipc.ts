import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { GoogleCalendarPlatform } from "@opencode-ai/app"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"

import type { FatalRendererError, ServerReadyData, TitlebarTheme } from "../preload/types"
import { resolveAppPath } from "./apps"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { setForceFocus } from "./debug"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { getStore, removeStoreFileIfEmpty } from "./store"
import { assertStoreName } from "./store-name"
import {
  getPinchZoomEnabled,
  getWindowID,
  openExternalURL,
  openLocalFileURL,
  setPinchZoomEnabled,
  setTitlebar,
  updateTitlebar,
} from "./windows"
import type { UpdaterController } from "./updater-controller"
import { createUpdaterSubscriptions } from "./updater-subscriptions"
import { createDesktopDraftStore } from "./draft-store"
import { saveSessionExport } from "./session-export"
import { nativeT } from "./native-translations"

// Renderer-supplied IPC is only trusted from the main frame of an app window:
// any other frame or webContents that reaches ipcRenderer must not reach the
// privileged handlers below (issue #25).
const assertTrustedSender = (event: IpcMainInvokeEvent | IpcMainEvent) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Untrusted IPC sender")
  }
}

const trustedHandle = <A extends unknown[]>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: A) => unknown,
) => {
  ipcMain.handle(channel, (event, ...args: A) => {
    assertTrustedSender(event)
    return listener(event, ...args)
  })
}

const trustedOn = <A extends unknown[]>(
  channel: string,
  listener: (event: IpcMainEvent, ...args: A) => unknown,
) => {
  ipcMain.on(channel, (event, ...args: A) => {
    assertTrustedSender(event)
    listener(event, ...args)
  })
}

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions: ext }]
}

const pickedFiles = createPickedFileAuthorizations()

type Deps = {
  killSidecar: () => Promise<void> | void
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  isFirstLaunchOnboardingPending: () => Promise<boolean> | boolean
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null> | string | null
  isOldLayoutEligible: () => Promise<boolean> | boolean
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null>
  updater: UpdaterController
  googleCalendar: GoogleCalendarPlatform
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

export function registerIpcHandlers(deps: Deps) {
  const drafts = createDesktopDraftStore(join(app.getPath("userData"), "drafts.sqlite"))
  const updaterSubscriptions = createUpdaterSubscriptions()
  const updaterSenders = new WeakSet<Electron.WebContents>()
  app.once("will-quit", updaterSubscriptions.clear)
  app.on("before-quit", () => drafts.flush())
  app.once("will-quit", () => drafts.close())
  app.on("browser-window-created", (_event, win) => win.on("session-end", () => drafts.flush()))

  trustedHandle("kill-sidecar", () => deps.killSidecar())
  trustedHandle("await-initialization", () => deps.awaitInitialization())
  trustedHandle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  trustedHandle("get-default-server-url", () => deps.getDefaultServerUrl())
  trustedHandle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  trustedHandle("is-first-launch-onboarding-pending", () => deps.isFirstLaunchOnboardingPending())
  trustedHandle("finish-first-launch-onboarding", (_event: IpcMainInvokeEvent, createDefaultProject: boolean) =>
    deps.finishFirstLaunchOnboarding(createDefaultProject),
  )
  trustedHandle("is-old-layout-eligible", () => deps.isOldLayoutEligible())
  trustedHandle("get-display-backend", () => deps.getDisplayBackend())
  trustedHandle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  trustedHandle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  trustedHandle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  trustedHandle("updater-subscribe", (event) => {
    const id = event.sender.id
    updaterSubscriptions.set(
      id,
      deps.updater.subscribe((state) => {
        if (event.sender.isDestroyed()) return updaterSubscriptions.delete(id)
        event.sender.send("updater-state", state)
      }),
    )
    if (!updaterSenders.has(event.sender)) {
      updaterSenders.add(event.sender)
      event.sender.once("destroyed", () => updaterSubscriptions.delete(id))
    }
  })
  trustedHandle("updater-unsubscribe", (event) => updaterSubscriptions.delete(event.sender.id))
  trustedHandle("updater-check", () => deps.updater.check())
  trustedHandle("updater-install", () => deps.updater.install())
  trustedHandle("google-calendar-status", () => deps.googleCalendar.status())
  trustedHandle(
    "google-calendar-connect",
    (event, input: Parameters<GoogleCalendarPlatform["connect"]>[0]) =>
      deps.googleCalendar.connect({ ...input, windowId: event.sender.id }),
  )
  trustedHandle("google-calendar-sync", () => deps.googleCalendar.sync())
  trustedHandle("google-calendar-write", (_event, input: Parameters<GoogleCalendarPlatform["write"]>[0]) =>
    deps.googleCalendar.write(input),
  )
  trustedHandle("google-task-write", (_event, input: Parameters<GoogleCalendarPlatform["writeTask"]>[0]) =>
    deps.googleCalendar.writeTask(input),
  )
  trustedHandle("google-calendar-disconnect", () => deps.googleCalendar.disconnect())
  trustedHandle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  trustedHandle("export-debug-logs", () => deps.exportDebugLogs())
  trustedHandle("set-force-focus", (event: IpcMainInvokeEvent, enabled: boolean) =>
    setForceFocus(event.sender, enabled),
  )
  trustedHandle("record-fatal-renderer-error", (_event: IpcMainInvokeEvent, error: FatalRendererError) =>
    deps.recordFatalRendererError(error),
  )
  trustedHandle("set-native-translations", (_event: IpcMainInvokeEvent, value: unknown) => {
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  trustedHandle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    assertStoreName(name)
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  trustedHandle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    assertStoreName(name)
    getStore(name).set(key, value)
  })
  trustedHandle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    assertStoreName(name)
    getStore(name).delete(key)
    void removeStoreFileIfEmpty(name)
  })
  trustedHandle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    assertStoreName(name)
    getStore(name).clear()
    void removeStoreFileIfEmpty(name)
  })
  trustedHandle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    assertStoreName(name)
    const store = getStore(name)
    return Object.keys(store.store)
  })
  trustedHandle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    assertStoreName(name)
    const store = getStore(name)
    return Object.keys(store.store).length
  })
  trustedHandle("draft-get", (_event, key: string) => drafts.get(key))
  trustedHandle("draft-set", (_event, key: string, value: string) => drafts.set(key, value))
  trustedHandle("draft-delete", (_event, key: string) => drafts.set(key, null))
  trustedHandle("draft-blob-put", (_event, data: ArrayBuffer) => drafts.putBlob(new Uint8Array(data)))
  trustedHandle("draft-blob-get", (_event, id: string) => {
    const data = drafts.getBlob(id)
    return data ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null
  })

  trustedHandle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFolder"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  trustedHandle(
    "open-file-picker",
    async (
      event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFile"),
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => ({
          path: filePath,
          name: basename(filePath),
          size: (await stat(filePath)).size,
        })),
      )
      assertAttachmentBudget(files)
      const token = pickedFiles.add(event.sender.id, result.filePaths)
      return { token, files }
    },
  )

  trustedHandle("read-picked-file", async (event: IpcMainInvokeEvent, token: string, filePath: string) => {
    return pickedFiles.read(event.sender.id, token, filePath)
  })

  trustedHandle("release-picked-files", (event: IpcMainInvokeEvent, token: string) => {
    pickedFiles.release(event.sender.id, token)
  })

  trustedHandle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? nativeT("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  trustedHandle("save-session-export", (event: IpcMainInvokeEvent, input: { filename: string; json: string }) =>
    saveSessionExport(input, async (filename) => {
      const options = {
        title: nativeT("desktop.dialog.saveFile"),
        defaultPath: filename,
        filters: [{ name: "JSON", extensions: ["json"] }],
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const result = await (owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options))
      return result.canceled ? null : (result.filePath ?? null)
    }),
  )

  trustedOn("open-external", (_event: IpcMainEvent, url: string) => {
    openExternalURL(url)
  })

  trustedOn("open-local-file", (_event: IpcMainEvent, url: string) => {
    openLocalFileURL(url)
  })

  // The renderer may only name an application, never hand over a path to
  // execute: main resolves the name through the registered-application lookup
  // so a compromised renderer cannot run an arbitrary binary (issue #23).
  trustedHandle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!isAbsolute(path)) throw new Error("open-path requires an absolute path")
    if (!app) return shell.openPath(path)
    if (!/^[\w][\w .()-]*$/.test(app)) throw new Error("Invalid application name")
    if (process.platform === "darwin") {
      return await new Promise<void>((resolve, reject) => {
        execFile("open", ["-a", app, path], (err) => (err ? reject(err) : resolve()))
      })
    }
    const resolved = await resolveAppPath(app)
    if (!resolved || !isAbsolute(resolved)) throw new Error("Unknown application")
    await new Promise<void>((resolve, reject) => {
      execFile(resolved, [path], (err) => (err ? reject(err) : resolve()))
    })
  })

  trustedHandle("reveal-path", async (_event: IpcMainInvokeEvent, path: string) => {
    if (!isAbsolute(path)) return false
    const exists = await stat(path).then(
      () => true,
      () => false,
    )
    if (!exists) return false
    shell.showItemInFolder(path)
    return true
  })

  trustedHandle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  trustedHandle("get-window-id", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error("Window not found")
    const id = getWindowID(win)
    if (!id) throw new Error("Window ID not found")
    return id
  })

  trustedHandle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  trustedHandle("get-window-fullscreen", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  trustedHandle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  trustedHandle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  trustedOn("relaunch", () => {
    deps.relaunch()
  })

  trustedHandle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  trustedHandle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  trustedHandle("get-pinch-zoom-enabled", () => getPinchZoomEnabled())
  trustedHandle("set-pinch-zoom-enabled", (_event: IpcMainInvokeEvent, enabled: boolean) => {
    setPinchZoomEnabled(enabled)
  })
  trustedHandle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  trustedHandle("run-desktop-menu-action", (event: IpcMainInvokeEvent, action: DesktopMenuAction) => {
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
