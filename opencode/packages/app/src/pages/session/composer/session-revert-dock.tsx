import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Reveal } from "@opencode-ai/ui/v2/reveal"
import { useLanguage } from "@/context/language"
import { createExitList } from "./exit-list"

export function SessionRevertDock(props: {
  items: { id: string; text: string }[]
  restoring?: string
  disabled?: boolean
  onRestore: (id: string) => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: true,
  })

  createEffect(() => {
    props.items.length
    props.items[0]?.id
    setStore("collapsed", true)
  })

  const toggle = () => setStore("collapsed", (value) => !value)
  const total = createMemo(() => props.items.length)
  const label = createMemo(() => language.plural("session.revertDock.summary", total()))
  const preview = createMemo(() => props.items[0]?.text ?? "")
  const entries = createExitList(
    () => props.items,
    (item) => item.id,
  )

  const onHeaderKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    toggle()
  }

  return (
    <div
      data-component="session-revert-dock"
      class="w-full overflow-hidden rounded-[24px] bg-v2-background-bg-layer-01"
    >
      <div
        class="flex h-[42px] items-center gap-2 pl-5 pr-3"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onHeaderKeyDown}
      >
        <IconV2 name="outline-reset" size="normal" class="text-v2-icon-icon-muted" />
        <span
          classList={{
            "font-[440] shrink-0 cursor-default text-[13px] leading-5 tracking-[-0.04px]": true,
            "text-v2-text-text-base": !store.collapsed,
            "text-v2-text-text-muted": store.collapsed,
          }}
        >
          {label()}
        </span>
        <Show when={store.collapsed && preview()}>
          <span class="min-w-0 flex-1 truncate cursor-default text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint animate-enter">
            {preview()}
          </span>
        </Show>
        <div class="ml-auto shrink-0">
          <IconButtonV2
            icon={<IconV2 name="outline-chevron-down" size="small" />}
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
              store.collapsed ? language.t("session.revertDock.expand") : language.t("session.revertDock.collapse")
            }
          />
        </div>
      </div>

      {/* The list folds through Reveal and rows expand in and collapse out (createExitList). The 18px below is
          sacrificial space the composer overlaps via its negative lift, so the header stays fully visible. */}
      <Reveal open={!store.collapsed}>
        {/* Scroll viewport ends above the composer */}
        <div class="flex max-h-42 flex-col overflow-y-auto px-5 pt-px pb-3 no-scrollbar">
          <For each={entries()}>
            {(entry, index) => (
              <Reveal open={entry.open}>
                <div classList={{ "flex h-6 min-w-0 items-center gap-2": true, "mt-2": index() > 0 }}>
                  <span class="min-w-0 flex-1 truncate text-[13px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
                    {entry.item.text}
                  </span>
                  <ButtonV2
                    size="small"
                    variant="neutral"
                    class="shrink-0"
                    disabled={props.disabled || !!props.restoring}
                    onClick={() => props.onRestore(entry.key)}
                  >
                    {language.t("session.revertDock.restore")}
                  </ButtonV2>
                </div>
              </Reveal>
            )}
          </For>
        </div>
      </Reveal>
      <div class="h-[18px]" aria-hidden="true" />
    </div>
  )
}
