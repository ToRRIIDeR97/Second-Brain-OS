import { Portal } from "solid-js/web"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { Icon } from "@opencode-ai/ui/icon"

export function FileSearchBar(props: {
  pos: () => { top: number; right: number }
  query: () => string
  index: () => number
  count: () => number
  setInput: (el: HTMLInputElement) => void
  onInput: (value: string) => void
  onKeyDown: (event: KeyboardEvent) => void
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const i18n = useI18n()

  return (
    <Portal>
      <div
        class="fixed z-50 flex h-8 items-center gap-2 rounded-full bg-v2-background-bg-base px-3 shadow-[var(--v2-elevation-floating)]"
        style={{
          top: `${props.pos().top}px`,
          right: `${props.pos().right}px`,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Icon name="magnifying-glass" size="small" class="text-v2-icon-icon-muted shrink-0" />
        <input
          ref={props.setInput}
          placeholder={i18n.t("ui.fileSearch.placeholder")}
          value={props.query()}
          class="w-40 bg-transparent outline-none text-[14px] text-v2-text-text-base placeholder:text-v2-text-text-faint"
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={(e) => props.onKeyDown(e as KeyboardEvent)}
        />
        <div class="shrink-0 text-[12px] text-v2-text-text-muted tabular-nums text-right" style={{ width: "10ch" }}>
          {props.count() ? `${props.index() + 1}/${props.count()}` : "0/0"}
        </div>
        <div class="flex items-center">
          <button
            type="button"
            class="size-6 grid place-items-center rounded-full text-v2-icon-icon-muted transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base motion-reduce:transition-none disabled:opacity-40 disabled:pointer-events-none"
            disabled={props.count() === 0}
            aria-label={i18n.t("ui.fileSearch.previousMatch")}
            onClick={props.onPrev}
          >
            <Icon name="chevron-down" size="small" class="rotate-180" />
          </button>
          <button
            type="button"
            class="size-6 grid place-items-center rounded-full text-v2-icon-icon-muted transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base motion-reduce:transition-none disabled:opacity-40 disabled:pointer-events-none"
            disabled={props.count() === 0}
            aria-label={i18n.t("ui.fileSearch.nextMatch")}
            onClick={props.onNext}
          >
            <Icon name="chevron-down" size="small" />
          </button>
        </div>
        <button
          type="button"
          class="size-6 grid place-items-center rounded-full text-v2-icon-icon-muted transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base motion-reduce:transition-none"
          aria-label={i18n.t("ui.fileSearch.close")}
          onClick={props.onClose}
        >
          <Icon name="close-small" size="small" />
        </button>
      </div>
    </Portal>
  )
}
