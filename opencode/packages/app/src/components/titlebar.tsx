import { createEffect, createMemo, createSignal, on, onMount, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createMediaQuery } from "@solid-primitives/media"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { WindowsAppMenu } from "./windows-app-menu"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import "./titlebar.css"

const titlebarHeight = 36
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.
const macTrafficLightsBaseWidth = 84

export type TitlebarUpdate = {
  version: () => string | undefined
  installing: () => boolean
  install: () => void
}

export function useTitlebarRightMount() {
  const language = useLanguage()
  const [mount, setMount] = createSignal<HTMLElement | null>(null)
  const sync = () => setMount(document.getElementById("opencode-titlebar-right"))
  onMount(sync)
  createEffect(on(language.direction, sync, { defer: true }))
  return mount
}

/** Window chrome: sidebar toggle, back/forward, update pill and native window controls. Navigation lives in the sidebar. */
export function Titlebar(props: { update?: TitlebarUpdate; debugTools?: { visible: boolean; toggle: () => void } }) {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const mobile = createMediaQuery("(max-width: 767px)")
  const bottom = createMemo(() => mobile() && settings.general.mobileTitlebarPosition() === "bottom")

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const macTrafficLights = createMemo(() => mac() && !platform.windowFullscreen?.())
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const minHeight = () => {
    if (mac()) return `${titlebarHeight / zoom()}px`
    if (windows()) return `${titlebarHeight / Math.min(titlebarZoom(), 1)}px`
    return undefined
  }
  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = path()

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const canBack = createMemo(() => history.index > 0)
  const canForward = createMemo(() => history.index < history.stack.length - 1)
  const updateState = createMemo<TitlebarUpdatePillState>(() => {
    const installing = props.update?.installing() ?? false
    const version = props.update?.version()
    return {
      visible: version !== undefined || installing,
      installing,
      label: language.t("titlebar.update"),
      ariaLabel: language.t("toast.update.action.installRestart"),
      title: version ? language.t("titlebar.updateVersion", { version }) : undefined,
      onInstall: () => props.update?.install(),
    }
  })

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  return (
    <header
      data-slot="titlebar-v2"
      classList={{
        "shrink-0 relative flex flex-row h-9 bg-v2-background-bg-deep overflow-visible": true,
        "order-last": bottom(),
      }}
      style={{
        "min-height": minHeight(),
        // Keep native macOS traffic lights clear even when the desktop window is narrow.
        "padding-left": macTrafficLights() ? `${macTrafficLightsBaseWidth / zoom()}px` : 0,
        width: windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        "max-width": windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        // Native Windows caption controls remain on the physical right in both writing directions.
        "margin-right": windows() ? "auto" : undefined,
      }}
      data-tauri-drag-region
    >
      <div
        class="h-full flex-1 overflow-hidden flex flex-row items-center gap-1.5 px-2 md:pr-3"
        classList={{
          "pt-2": !bottom(),
          "pb-2": bottom(),
          "md:pl-2": macTrafficLights(),
          "md:pl-4": !macTrafficLights(),
        }}
      >
        <ChannelIndicator debugTools={props.debugTools} />
        <Show when={windows() || linux()}>
          <WindowsAppMenu command={command} platform={platform} variant="v2" />
        </Show>
        <TooltipV2
          placement="bottom"
          value={
            <>
              {language.t("command.sidebar.toggle")}
              <KeybindV2 keys={command.keybindParts("sidebar.toggle")} variant="neutral" />
            </>
          }
          class="shrink-0"
        >
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            icon={<Icon size="small" name={layout.sidebar.opened() ? "sidebar-active" : "sidebar"} />}
            onClick={layout.sidebar.toggle}
            aria-label={language.t("command.sidebar.toggle")}
            aria-expanded={layout.sidebar.opened()}
          />
        </TooltipV2>
        <Show when={settings.general.showNavigation()}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            icon={<Icon size="small" name="chevron-left" />}
            disabled={!canBack()}
            onClick={back}
            aria-label={language.t("common.goBack")}
          />
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            icon={<Icon size="small" name="chevron-right" />}
            disabled={!canForward()}
            onClick={forward}
            aria-label={language.t("common.goForward")}
          />
        </Show>
        <div class="flex-1" />
        <TitlebarV2Right update={updateState()} />
      </div>
    </header>
  )
}

type TitlebarUpdatePillState = {
  visible: boolean
  installing: boolean
  label: string
  ariaLabel: string
  title?: string
  onInstall: () => void
}

function TitlebarV2Right(props: { update: TitlebarUpdatePillState }) {
  return (
    <div class="relative z-20 flex shrink-0 items-center justify-end gap-0 overflow-visible">
      <Show when={props.update.visible}>
        <TitlebarUpdateIconButton state={props.update} />
      </Show>
      <div id="opencode-titlebar-right" class="flex shrink-0 items-center justify-end gap-0" />
    </div>
  )
}

function TitlebarUpdateIconButton(props: { state: TitlebarUpdatePillState }) {
  return (
    <div class="group relative mr-3 h-5 w-5 shrink-0 rounded-full bg-v2-background-bg-deep transition-[width] duration-150 ease-standard hover:z-30 hover:w-[68px] focus-within:z-30 focus-within:w-[68px] motion-reduce:transition-none">
      <button
        type="button"
        class="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-end overflow-hidden rounded-full bg-v2-icon-icon-accent/20 text-v2-icon-icon-accent transition-[width,background-color] duration-150 ease-standard group-hover:w-[68px] group-hover:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] group-focus-within:w-[68px] group-focus-within:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus disabled:opacity-60 motion-reduce:transition-none"
        onClick={props.state.onInstall}
        disabled={props.state.installing}
        aria-busy={props.state.installing}
        aria-label={props.state.ariaLabel}
        title={props.state.title}
      >
        <span class="shrink-0 ml-[8px] mr-px text-[11px] text-v2-text-text-accent [font-weight:530] opacity-0 translate-x-2 motion-safe:transition-all duration-150 ease-standard group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 motion-reduce:translate-x-0">
          {props.state.label}
        </span>
        <span class="flex size-5 shrink-0 items-center justify-center">
          <Show
            when={!props.state.installing}
            fallback={<span data-slot="titlebar-update-loader" aria-hidden="true" />}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 11V3M3.5 7.63128L7 11L10.5 7.63128" stroke="currentColor" />
            </svg>
          </Show>
        </span>
      </button>
    </div>
  )
}

function ChannelIndicator(props: { debugTools?: { visible: boolean; toggle: () => void } }) {
  const channel = import.meta.env.VITE_OPENCODE_CHANNEL
  if (channel === "dev" && props.debugTools) {
    return (
      <button
        type="button"
        class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-full uppercase font-mono cursor-pointer"
        onClick={props.debugTools.toggle}
        aria-label="Toggle debug tools"
        aria-pressed={props.debugTools.visible}
      >
        DEV
      </button>
    )
  }

  return (
    <>
      {["beta", "dev"].includes(channel) && (
        <div class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-full uppercase font-mono">
          {channel.toUpperCase()}
        </div>
      )}
    </>
  )
}
