import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { GoogleCalendarPlatform } from "@opencode-ai/app"
import type { WslServersPlatform } from "@opencode-ai/app/wsl/types"
import type { UpdaterState } from "@opencode-ai/app/updater"
import type { DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@opencode-ai/app/wsl/types"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type WslServersAPI = WslServersPlatform
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}
export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  awaitInitialization: () => Promise<ServerReadyData>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  googleCalendar: GoogleCalendarPlatform
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  isFirstLaunchOnboardingPending: () => Promise<boolean>
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null>
  isOldLayoutEligible: () => Promise<boolean>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  checkAppExists: (appName: string) => Promise<boolean>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>
  draftGet: (key: string) => Promise<string | null>
  draftSet: (key: string, value: string) => Promise<void>
  draftDelete: (key: string) => Promise<void>
  draftBlobPut: (data: ArrayBuffer) => Promise<string>
  draftBlobGet: (id: string) => Promise<ArrayBuffer | null>

  getWindowID: () => Promise<string>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveSessionExport: (input: { filename: string; json: string }) => Promise<boolean>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openExternal: (url: string) => void
  openLocalFile: (url: string) => void
  fileViewerURL: (directory: string, path: string) => Promise<string | undefined>
  browser: BrowserAPI
  device: DeviceAPI
  openPath: (path: string, app?: string) => Promise<void>
  revealPath: (path: string) => Promise<boolean>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  getWindowFocused: () => Promise<boolean>
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  setForceFocus: (enabled: boolean) => Promise<void>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
  setNativeTranslations: (bundle: DesktopNativeBundle) => Promise<void>
}

export type BrowserBounds = { x: number; y: number; width: number; height: number }
export type BrowserState = { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
export type PickedElement = {
  selector: string
  tag: string
  text: string
  html: string
  rect: BrowserBounds
  styles: Record<string, string>
}
export type BrowserAPI = {
  show: (bounds?: BrowserBounds) => Promise<void>
  navigate: (url: string) => Promise<void>
  history: (direction: "back" | "forward" | "reload") => Promise<void>
  capture: (rect?: BrowserBounds) => Promise<string | undefined>
  pick: () => Promise<PickedElement | null>
  onState: (cb: (state: BrowserState) => void) => () => void
  onAgent: (cb: (event: { tool: string }) => void) => () => void
}

export type DevicePlatform = "android" | "ios"
export type DeviceInfo = { platform: DevicePlatform; id: string; name: string; state: string }
export type DeviceStatus = {
  android: { sdk: boolean; devices: DeviceInfo[]; avds: string[] }
  ios: { supported: boolean; devices: DeviceInfo[]; input: boolean }
}
export type DeviceInputEvent =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x: number; y: number; toX: number; toY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: "home" | "back" | "enter" }
export type DeviceAPI = {
  status: () => Promise<DeviceStatus>
  boot: (platform: DevicePlatform, id: string) => Promise<void>
  screenshot: (platform: DevicePlatform, id: string) => Promise<string | undefined>
  input: (platform: DevicePlatform, id: string, input: DeviceInputEvent) => Promise<void>
  onAgent: (cb: (event: { tool: string; platform: DevicePlatform; id: string }) => void) => () => void
}
