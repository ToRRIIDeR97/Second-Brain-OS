import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { DESIGN_SANDBOX, designDocument, designTooLarge, type Design } from "@opencode-ai/session-ui/design-fence"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { useDesignCanvas } from "@/pages/session/design-canvas"

// Previews lay a design out at a desktop width, then scale it down to the card.
const ARTBOARD_WIDTH = 1280
const ARTBOARD_HEIGHT = 800

/** The Canvas tab: the thread's designs as a grid of artboards, or one of them shown large. */
export function SessionCanvasTab() {
  const canvas = useDesignCanvas()
  const language = useLanguage()
  const designs = createMemo(() => canvas.designs())
  // Equal by id, so the keyed large view and its frame are built once per design, not per streamed token.
  const selected = createMemo<Design | undefined>(
    () => designs().find((design) => design.id === canvas.selected()),
    undefined,
    {
      equals: (a, b) => a?.id === b?.id,
    },
  )
  const title = (design: Design) => design.title ?? language.t("secondBrain.canvas.untitled")

  return (
    <Show
      when={selected()}
      keyed
      fallback={
        <Show
          when={designs().length > 0}
          fallback={
            <div class="h-full px-6 pb-42 flex items-center justify-center text-center">
              <div class="max-w-56 text-[13px] leading-5 text-v2-text-text-muted">
                {language.t("secondBrain.canvas.empty")}
              </div>
            </div>
          }
        >
          <div class="h-full overflow-y-auto px-3 pb-3">
            <div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              <For each={designs()}>
                {(design) => (
                  <div class="flex min-w-0 flex-col gap-1.5 rounded-[12px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1.5">
                    <button
                      type="button"
                      class="relative block aspect-[16/10] w-full overflow-hidden rounded-[8px] bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                      aria-label={language.t("secondBrain.canvas.view", { title: title(design) })}
                      onClick={() => canvas.select(design.id)}
                    >
                      <DesignPreview design={design} title={title(design)} />
                    </button>
                    <div class="flex min-w-0 items-center gap-2 pl-1.5">
                      <span class="min-w-0 truncate text-[13px] text-v2-text-text-base">{title(design)}</span>
                      <ButtonV2
                        size="small"
                        variant="ghost"
                        class="ml-auto shrink-0"
                        onClick={() => canvas.use(design)}
                      >
                        {language.t("secondBrain.canvas.use")}
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      }
    >
      {(design) => (
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex shrink-0 items-center gap-2 px-3 pb-2">
            <IconButtonV2
              icon={<Icon name="arrow-left" />}
              variant="ghost-muted"
              aria-label={language.t("secondBrain.canvas.back")}
              onClick={() => canvas.select(undefined)}
            />
            <span class="min-w-0 truncate text-[13px] text-v2-text-text-base [font-weight:530]">{title(design)}</span>
            <ButtonV2 size="small" variant="neutral" class="ml-auto shrink-0" onClick={() => canvas.use(design)}>
              {language.t("secondBrain.canvas.use")}
            </ButtonV2>
          </div>
          <div class="min-h-0 flex-1 px-3 pb-3">
            <div class="size-full overflow-hidden rounded-[12px] border border-v2-border-border-muted bg-white">
              <DesignFrame design={design} title={title(design)} class="block size-full border-0" />
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}

function DesignPreview(props: { design: Design; title: string }) {
  const [scale, setScale] = createSignal(0)
  let box!: HTMLDivElement
  onMount(() => {
    const observer = new ResizeObserver((entries) => setScale((entries[0]?.contentRect.width ?? 0) / ARTBOARD_WIDTH))
    observer.observe(box)
    onCleanup(() => observer.disconnect())
  })
  return (
    <div ref={box} class="absolute inset-0" aria-hidden="true">
      <DesignFrame
        design={props.design}
        title={props.title}
        class="pointer-events-none origin-top-left border-0"
        style={{ width: `${ARTBOARD_WIDTH}px`, height: `${ARTBOARD_HEIGHT}px`, transform: `scale(${scale()})` }}
        preview
      />
    </div>
  )
}

/** The design in a sandboxed frame (see design-fence.ts), or a notice when it is over the size cap. */
function DesignFrame(props: {
  design: Design
  title: string
  class: string
  style?: Record<string, string>
  preview?: boolean
}) {
  const language = useLanguage()
  return (
    <Show
      when={!designTooLarge(props.design.source)}
      fallback={
        <div class="flex size-full items-center justify-center p-4 text-center text-[13px] text-v2-text-text-muted bg-v2-background-bg-layer-01">
          {language.t("secondBrain.canvas.tooLarge")}
        </div>
      }
    >
      <iframe
        ref={(el) => {
          // Sandboxed before the document is set and before the frame is attached.
          el.setAttribute("sandbox", DESIGN_SANDBOX)
          el.srcdoc = designDocument(props.design.source)
        }}
        referrerpolicy="no-referrer"
        loading="lazy"
        title={props.title}
        tabIndex={props.preview ? -1 : undefined}
        class={props.class}
        style={props.style}
      />
    </Show>
  )
}
