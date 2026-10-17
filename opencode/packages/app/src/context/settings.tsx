import { createStore, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted } from "@/utils/persist"
import { usePlatform } from "@/context/platform"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export interface Settings {
  general: {
    autoSave: boolean
    followup: "queue" | "steer"
    showFileTree: boolean
    showNavigation: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showCustomAgents: boolean
    mobileTitlebarPosition: "top" | "bottom"
    agentVisibilityInitialized?: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    terminal: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
  harnesses?: {
    /** Model IDs left out of each harness's picker, by harness instance ID. New models show by default. */
    hiddenModels?: Record<string, string[]>
  }
}

/** A harness with the models the user hid in Settings left out. */
export function withVisibleModels<T extends { id: string; models: ReadonlyArray<{ id: string }> }>(
  instance: T,
  hidden: ReadonlyArray<string> | undefined,
): T {
  if (!hidden?.length) return instance
  const skip = new Set(hidden)
  return { ...instance, models: instance.models.filter((model) => !skip.has(model.id)) }
}

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
export function hasExistingWebState(settings: Promise<string> | string | null, previousVersion: string | undefined) {
  return settings !== null || previousVersion !== undefined
}

export function initialAgentVisibility(initialized: boolean | undefined, existing: boolean, previousVersion?: string) {
  if (initialized === true) return
  return existing || previousVersion !== undefined
}

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    followup: "steer",
    showFileTree: false,
    showNavigation: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showCustomAgents: false,
    mobileTitlebarPosition: "top",
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    terminal: "",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const [store, setStore, settingsInit, ready] = persisted("settings.v3", createStore<Settings>(defaultSettings))
    const [launch, setLaunch, , launchReady] = persisted(
      "app-version.v1",
      createStore<{ version?: string }>({ version: undefined }),
    )
    const [launchState, setLaunchState] = createStore({
      classified: false,
      previous: undefined as string | undefined,
    })
    const showFileTree = withFallback(() => store.general?.showFileTree, defaultSettings.general.showFileTree)
    const showStatus = withFallback(() => store.general?.showStatus, defaultSettings.general.showStatus)
    const showCustomAgents = withFallback(
      () => store.general?.showCustomAgents,
      defaultSettings.general.showCustomAgents,
    )
    const visible = (preference: () => boolean) => createMemo(() => preference())
    const initializeAgentVisibility = (existing: boolean) => {
      const initial = initialAgentVisibility(store.general?.agentVisibilityInitialized, existing, launchState.previous)
      if (initial === undefined) return
      batch(() => {
        setStore("general", "showCustomAgents", initial)
        setStore("general", "agentVisibilityInitialized", true)
      })
    }

    createEffect(() => {
      if (!launchReady() || launchState.classified) return
      setLaunchState({
        classified: true,
        previous: launch.version,
      })
      if (!platform.version || launch.version === platform.version) return
      setLaunch("version", platform.version)
    })

    createEffect(() => {
      if (!ready() || !launchState.classified || platform.platform !== "web") return
      initializeAgentVisibility(hasExistingWebState(settingsInit, launchState.previous))
    })

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        followup: withFallback(() => store.general?.followup, defaultSettings.general.followup),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value)
        },
        showFileTree,
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showStatus,
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        showCustomAgents,
        setShowCustomAgents(value: boolean) {
          setStore("general", "showCustomAgents", value)
        },
        mobileTitlebarPosition: withFallback(
          () => store.general?.mobileTitlebarPosition,
          defaultSettings.general.mobileTitlebarPosition,
        ),
        setMobileTitlebarPosition(value: "top" | "bottom") {
          setStore("general", "mobileTitlebarPosition", value)
        },
        initializeAgentVisibility,
      },
      visibility: {
        fileTree: visible(showFileTree),
        status: visible(showStatus),
        customAgents: visible(showCustomAgents),
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      harnesses: {
        hiddenModels: (instanceID: string) => store.harnesses?.hiddenModels?.[instanceID] ?? [],
        setModelHidden(instanceID: string, modelID: string, hidden: boolean) {
          const current = store.harnesses?.hiddenModels?.[instanceID] ?? []
          const next = hidden ? [...new Set([...current, modelID])] : current.filter((item) => item !== modelID)
          setStore("harnesses", (value) => ({
            ...value,
            hiddenModels: { ...value?.hiddenModels, [instanceID]: next },
          }))
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
