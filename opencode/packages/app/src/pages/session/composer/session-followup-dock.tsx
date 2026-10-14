import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"

// Lists messages the server holds with queue delivery. Items leave when the runner promotes them, or
// when the user removes one or sends it now (steer). Actions are absent when the server cannot do either.
export function SessionFollowupDock(props: {
  items: { id: string; text: string }[]
  pending?: string
  actions?: {
    onRemove: (id: string) => void
    onSend: (id: string) => void
  }
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: false,
  })

  const toggle = () => setStore("collapsed", (value) => !value)
  const total = createMemo(() => props.items.length)
  const label = createMemo(() => language.plural("session.followupDock.summary", total()))
  const preview = createMemo(() => props.items[0]?.text ?? "")

  return (
    <DockTray
      data-component="session-followup-dock"
      style={{
        "margin-bottom": "-0.875rem",
        "border-bottom-left-radius": 0,
        "border-bottom-right-radius": 0,
      }}
    >
      <div
        class="pl-3 pr-2 py-2 flex items-center gap-2"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="shrink-0 text-13-medium text-text-strong cursor-default">{label()}</span>
        <Show when={store.collapsed && preview()}>
          <span class="min-w-0 flex-1 truncate text-13-regular text-text-base cursor-default">{preview()}</span>
        </Show>
        <div class="ml-auto shrink-0">
          <IconButton
            data-collapsed={store.collapsed ? "true" : "false"}
            icon="chevron-down"
            size="normal"
            variant="ghost"
            style={{ transform: `rotate(${store.collapsed ? 180 : 0}deg)` }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            aria-label={
              store.collapsed ? language.t("session.followupDock.expand") : language.t("session.followupDock.collapse")
            }
          />
        </div>
      </div>

      <Show when={store.collapsed}>
        <div class="h-5" aria-hidden="true" />
      </Show>

      <Show when={!store.collapsed}>
        <div class="px-3 pb-7 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar">
          <For each={props.items}>
            {(item) => (
              <div class="flex items-center gap-2 min-w-0 py-1" data-queued-id={item.id}>
                <span class="min-w-0 flex-1 truncate text-13-regular text-text-strong">{item.text}</span>
                <Show when={props.actions}>
                  {(actions) => (
                    <>
                      <Button
                        size="small"
                        variant="secondary"
                        class="shrink-0"
                        disabled={!!props.pending}
                        data-pending={props.pending === item.id ? "true" : undefined}
                        onClick={() => actions().onSend(item.id)}
                      >
                        {language.t("session.followupDock.sendNow")}
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        class="shrink-0"
                        disabled={!!props.pending}
                        onClick={() => actions().onRemove(item.id)}
                      >
                        {language.t("session.followupDock.remove")}
                      </Button>
                    </>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </DockTray>
  )
}
