import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Reveal } from "@opencode-ai/ui/v2/reveal"
import { useLanguage } from "@/context/language"
import { createExitList } from "./exit-list"

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
  const entries = createExitList(
    () => props.items,
    (item) => item.id,
  )

  return (
    <div
      data-component="session-followup-dock"
      class="w-full overflow-hidden rounded-[24px] bg-v2-background-bg-layer-01"
      style={{ "margin-bottom": "-0.875rem" }}
    >
      <div
        class="flex h-[42px] items-center gap-2 pl-5 pr-3"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="shrink-0 cursor-default text-[13px] leading-5 text-v2-text-text-base [font-weight:530]">
          {label()}
        </span>
        <Show when={store.collapsed && preview()}>
          <span class="min-w-0 flex-1 truncate cursor-default text-[13px] leading-5 text-v2-text-text-faint animate-enter">
            {preview()}
          </span>
        </Show>
        <div class="ml-auto shrink-0">
          <IconButtonV2
            data-collapsed={store.collapsed ? "true" : "false"}
            icon={<Icon name="outline-chevron-down" size="small" />}
            size="large"
            variant="ghost-muted"
            class="transition-transform motion-reduce:transition-none"
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

      {/* The list folds through Reveal; the spacer below stays, so collapsed and open share the bottom edge
          the composer overlaps. Rows expand in and collapse out (createExitList). */}
      <Reveal open={!store.collapsed}>
        <div class="px-5 pb-2 flex flex-col max-h-42 overflow-y-auto no-scrollbar">
          <For each={entries()}>
            {(entry, index) => (
              <Reveal open={entry.open}>
                <div
                  classList={{ "flex items-center gap-2 min-w-0 py-1": true, "mt-1.5": index() > 0 }}
                  data-queued-id={entry.key}
                >
                  <span class="min-w-0 flex-1 truncate text-[13px] leading-5 text-v2-text-text-base">
                    {entry.item.text}
                  </span>
                  <Show when={props.actions}>
                    {(actions) => (
                      <>
                        <ButtonV2
                          size="small"
                          variant="neutral"
                          class="shrink-0"
                          disabled={!!props.pending}
                          data-pending={props.pending === entry.key ? "true" : undefined}
                          onClick={() => actions().onSend(entry.key)}
                        >
                          {language.t("session.followupDock.sendNow")}
                        </ButtonV2>
                        <ButtonV2
                          size="small"
                          variant="ghost"
                          class="shrink-0"
                          disabled={!!props.pending}
                          onClick={() => actions().onRemove(entry.key)}
                        >
                          {language.t("secondBrain.followupDock.remove")}
                        </ButtonV2>
                      </>
                    )}
                  </Show>
                </div>
              </Reveal>
            )}
          </For>
        </div>
      </Reveal>
      <div class="h-5" aria-hidden="true" />
    </div>
  )
}
