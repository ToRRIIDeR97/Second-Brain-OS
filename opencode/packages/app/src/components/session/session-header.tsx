import { getFilename } from "@opencode-ai/core/util/path"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { StatusPopoverV2 } from "../status-popover"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { reviewTooltipKeybind } from "../command-tooltip-keybind"
import { useTitlebarRightMount } from "../titlebar"

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const { params, view } = useSessionLayout()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybindParts("file.open"))
  const search = settings.visibility.search
  const status = settings.visibility.status
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const v2ActionsState = createMemo<SessionHeaderV2ActionsState>(() => ({
    statusVisible: status(),
    statusLabel: language.t("status.popover.trigger"),
    reviewLabel: language.t("command.review.toggle"),
    reviewKeybind: reviewTooltipKeybind(command),
    reviewVisible: isDesktop(),
    reviewOpened: view().reviewPanel.opened(),
    onReviewToggle: () => view().reviewPanel.toggle(),
    terminalLabel: language.t("command.terminal.toggle"),
    terminalKeybind: command.keybindParts("terminal.toggle"),
    terminalOpened: view().terminal.opened(),
    onTerminalToggle: () => command.trigger("terminal.toggle"),
  }))

  const [centerMount, setCenterMount] = createSignal<HTMLElement | null>(null)
  const rightMount = useTitlebarRightMount()
  onMount(() => {
    setCenterMount(document.getElementById("opencode-titlebar-center"))
  })

  return (
    <>
      <Show when={search() && centerMount()} keyed>
        {(mount) => (
          <Portal mount={mount}>
            <button
              type="button"
              class="hidden md:flex h-7 w-[320px] max-w-full min-w-0 items-center gap-2 rounded-full bg-v2-background-bg-layer-01 pl-3 pr-1.5 text-v2-text-text-faint transition-colors duration-150 ease-standard hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <IconV2 name="magnifying-glass" size="small" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate text-left text-[12px]">
                {language.t("session.header.search.placeholder", {
                  project: name(),
                })}
              </span>
              <Show when={hotkey().length > 0}>
                <KeybindV2 keys={hotkey()} variant="ghost" class="shrink-0" />
              </Show>
            </button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()} keyed>
        {(mount) => (
          <Portal mount={mount}>
            <SessionHeaderV2Actions state={v2ActionsState()} />
          </Portal>
        )}
      </Show>
    </>
  )
}

type SessionHeaderV2ActionsState = {
  statusVisible: boolean
  statusLabel: string
  reviewLabel: string
  reviewKeybind: string[]
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
  terminalLabel: string
  terminalKeybind: string[]
  terminalOpened: boolean
  onTerminalToggle: () => void
}

function SessionHeaderV2Actions(props: { state: SessionHeaderV2ActionsState }) {
  return (
    <div class="flex items-center gap-1">
      <Show when={props.state.statusVisible}>
        <TooltipV2 class="shrink-0" placement="bottom" value={props.state.statusLabel}>
          <StatusPopoverV2 />
        </TooltipV2>
      </Show>
      <TooltipV2
        class="shrink-0"
        placement="bottom"
        value={
          <>
            {props.state.terminalLabel}
            <Show when={props.state.terminalKeybind.length > 0}>
              <KeybindV2 keys={props.state.terminalKeybind} variant="neutral" />
            </Show>
          </>
        }
      >
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          class="shrink-0"
          state={props.state.terminalOpened ? "pressed" : undefined}
          onClick={props.state.onTerminalToggle}
          aria-label={props.state.terminalLabel}
          aria-expanded={props.state.terminalOpened}
          aria-controls="terminal-panel"
          icon={<IconV2 name="terminal" />}
        />
      </TooltipV2>
      <Show when={props.state.reviewVisible}>
        <TooltipV2
          class="shrink-0"
          placement="bottom"
          value={
            <>
              {props.state.reviewLabel}
              <Show when={props.state.reviewKeybind.length > 0}>
                <KeybindV2 keys={props.state.reviewKeybind} variant="neutral" />
              </Show>
            </>
          }
        >
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            state={props.state.reviewOpened ? "pressed" : undefined}
            onClick={props.state.onReviewToggle}
            aria-label={props.state.reviewLabel}
            aria-expanded={props.state.reviewOpened}
            aria-controls="review-panel"
            icon={<IconV2 name="sidebar-right" />}
          />
        </TooltipV2>
      </Show>
    </div>
  )
}
