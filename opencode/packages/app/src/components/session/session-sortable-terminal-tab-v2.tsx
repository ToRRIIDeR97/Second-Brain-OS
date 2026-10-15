import type { JSX } from "solid-js"
import { Show, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSortable } from "@dnd-kit/solid/sortable"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { isDefaultTitle as isDefaultTerminalTitle } from "@/context/terminal-title"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLanguage } from "@/context/language"
import { focusTerminalById } from "@/pages/session/helpers"
import { SessionTabClose } from "./session-tab-close"

export function SortableTerminalTabV2(props: {
  terminal: LocalPTY
  index: () => number
  onClose?: () => void
}): JSX.Element {
  const terminal = useTerminal()
  const language = useLanguage()
  const sortable = useSortable({
    get id() {
      return props.terminal.id
    },
    get index() {
      return props.index()
    },
  })
  const [store, setStore] = createStore({
    editing: false,
    title: props.terminal.title,
    blurEnabled: false,
  })
  let input: HTMLInputElement | undefined
  let blurFrame: number | undefined
  let editRequested = false

  const isDefaultTitle = () => {
    const number = props.terminal.titleNumber
    if (!Number.isFinite(number) || number <= 0) return false
    return isDefaultTerminalTitle(props.terminal.title, number)
  }

  const label = () => {
    language.locale()
    if (props.terminal.title && !isDefaultTitle()) return props.terminal.title

    const number = props.terminal.titleNumber
    if (Number.isFinite(number) && number > 0) return language.t("terminal.title.numbered", { number })
    if (props.terminal.title) return props.terminal.title
    return language.t("terminal.title")
  }

  const close = () => {
    const count = terminal.all().length
    void terminal.close(props.terminal.id)
    if (count === 1) {
      props.onClose?.()
    }
  }

  const focus = () => {
    if (store.editing) return
    terminal.requestFocus(props.terminal.id)
    terminal.open(props.terminal.id)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    focusTerminalById(props.terminal.id)
    const input = document.getElementById(`terminal-wrapper-${props.terminal.id}`)?.querySelector("textarea")
    if (input === document.activeElement) terminal.consumeFocus(props.terminal.id)
  }

  const edit = (e?: Event) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }

    setStore("blurEnabled", false)
    setStore("title", props.terminal.title)
    setStore("editing", true)
  }

  const save = () => {
    if (!store.blurEnabled) return

    const value = store.title.trim()
    if (value && value !== props.terminal.title) {
      terminal.update({ id: props.terminal.id, title: value })
    }
    setStore("editing", false)
  }

  const keydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      save()
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setStore("editing", false)
    }
  }

  createEffect(() => {
    if (!store.editing) return
    if (!input) return
    input.focus()
    input.select()
    if (blurFrame !== undefined) cancelAnimationFrame(blurFrame)
    blurFrame = requestAnimationFrame(() => {
      blurFrame = undefined
      setStore("blurEnabled", true)
    })
  })

  onCleanup(() => {
    if (blurFrame === undefined) return
    cancelAnimationFrame(blurFrame)
  })

  return (
    <div ref={sortable.ref} class="h-full flex items-center outline-none focus:outline-none focus-visible:outline-none">
      <MenuV2.Context>
        <MenuV2.Context.Trigger class="relative" as="div">
          <TabsV2.Trigger
            value={props.terminal.id}
            onMouseDown={(e) => {
              // Switch on mousedown to shave the press-release delay off tab switches.
              if (e.button !== 0) return
              if (store.editing) return
              focus()
            }}
            onClick={(e) => {
              // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
              if (e.detail > 0) return
              focus()
            }}
            onMiddleClick={close}
          >
            <span
              class="truncate"
              data-slot="terminal-tab-title"
              onDblClick={edit}
              classList={{ invisible: store.editing }}
            >
              {label()}
            </span>
            <SessionTabClose label={language.t("terminal.close")} onClose={close} />
          </TabsV2.Trigger>
          <Show when={store.editing}>
            <div class="absolute inset-0 z-10 flex items-center rounded-full bg-v2-background-bg-layer-02 px-3 pointer-events-auto">
              <input
                ref={input}
                type="text"
                value={store.title}
                onInput={(e) => setStore("title", e.currentTarget.value)}
                onBlur={save}
                onKeyDown={keydown}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={language.t("common.rename")}
                class="bg-transparent border-none outline-none min-w-0 flex-1 p-0 text-[12px] leading-4 text-v2-text-text-base [font-weight:500] [font-variant-numeric:tabular-nums]"
              />
            </div>
          </Show>
        </MenuV2.Context.Trigger>
        <MenuV2.Context.Portal>
          <MenuV2.Context.Content
            onCloseAutoFocus={(e) => {
              if (!editRequested) return
              e.preventDefault()
              editRequested = false
              requestAnimationFrame(() => edit())
            }}
          >
            <MenuV2.Item onSelect={() => (editRequested = true)}>{language.t("common.rename")}</MenuV2.Item>
            <MenuV2.Item onSelect={close}>{language.t("common.close")}</MenuV2.Item>
          </MenuV2.Context.Content>
        </MenuV2.Context.Portal>
      </MenuV2.Context>
    </div>
  )
}
