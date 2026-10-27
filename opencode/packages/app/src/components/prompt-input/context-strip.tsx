import "./context-strip.css"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { ProgressCircleV2 } from "@opencode-ai/ui/v2/progress-circle-v2"
import { Index, Show, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup } from "solid-js"
import { openSessionContext } from "@/components/session-context-usage"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { getSessionContext } from "@/components/session/session-context-metrics"
import { getSessionUsage } from "@/components/session/session-usage"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { contextTokenRows, formatShare, threadWorktree } from "./context-strip-model"

const TOKEN_LABEL = {
  input: "secondBrain.sessionTab.input",
  cacheRead: "secondBrain.contextStrip.cacheRead",
  cacheWrite: "secondBrain.contextStrip.cacheWrite",
  output: "secondBrain.sessionTab.output",
  reasoning: "secondBrain.contextStrip.reasoning",
} as const

export type ComposerContext = ReturnType<typeof createComposerContext>

/**
 * State shared by the composer's context ring and the strip above the composer: the thread's context use and
 * whether the strip is unfolded into the context sheet. A click outside both, or Esc, folds the sheet back.
 */
export function createComposerContext() {
  const sync = useSync()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)
  const { params } = useSessionLayout()
  const messages = createMemo(() => (params.id ? (sync().data.message[params.id] ?? []) : []))
  const context = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const [open, setOpen] = createSignal(false)
  const id = createUniqueId()
  const elements: { ring?: HTMLElement; sheet?: HTMLElement } = {}
  const within = (node: EventTarget | null | undefined) =>
    node instanceof Node && (!!elements.sheet?.contains(node) || !!elements.ring?.contains(node))
  const close = () => {
    // Folding hides the sheet's controls, so focus inside it returns to the ring.
    const refocus = !!elements.sheet?.contains(document.activeElement)
    setOpen(false)
    if (refocus) elements.ring?.focus()
  }

  createEffect(
    on(
      () => params.id,
      () => setOpen(false),
      { defer: true },
    ),
  )
  createEffect(() => !context() && setOpen(false))
  createEffect(() => {
    if (!open()) return
    const pointer = (event: PointerEvent) => !event.composedPath().some((node) => within(node)) && close()
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      // Leave Esc to whatever else holds focus, such as an open menu or the editor.
      const active = document.activeElement
      if (active && active !== document.body && !within(active)) return
      event.preventDefault()
      setOpen(false)
      elements.ring?.focus()
    }
    // Tabbing out of both the ring and the sheet folds it, so it never stays open behind focus elsewhere.
    const focus = (event: FocusEvent) => !within(event.target) && setOpen(false)
    document.addEventListener("pointerdown", pointer, true)
    document.addEventListener("keydown", key)
    document.addEventListener("focusin", focus)
    onCleanup(() => {
      document.removeEventListener("pointerdown", pointer, true)
      document.removeEventListener("keydown", key)
      document.removeEventListener("focusin", focus)
    })
  })

  // The sheet sits before the composer in the DOM, so opening it from the keyboard (a click with no pointer
  // presses, `detail` 0) moves focus to its first control; a pointer open leaves focus where it is.
  const toggle = (event: MouseEvent) => {
    if (open()) return close()
    if (!context()) return
    setOpen(true)
    if (event.detail !== 0) return
    queueMicrotask(() =>
      elements.sheet
        ?.querySelector<HTMLElement>(
          '[data-slot="context-sheet-body"] :is(button, a[href], [tabindex]:not([tabindex="-1"])):not(:disabled)',
        )
        ?.focus({ preventScroll: true }),
    )
  }

  return {
    id,
    messages,
    context,
    open,
    close,
    toggle,
    setRing: (el: HTMLElement) => (elements.ring = el),
    setSheet: (el: HTMLElement) => (elements.sheet = el),
  }
}

/** The composer's context ring: it fills with the share of the context window used and unfolds the sheet. */
export function ComposerContextRing(props: { context: ComposerContext }) {
  const language = useLanguage()
  const { params } = useSessionLayout()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const label = () => {
    const value = props.context.context()
    if (!value) return ""
    if (value.usage === null)
      return language.t("secondBrain.contextStrip.ringTokens", { count: formatter().number(value.total) })
    return language.t("secondBrain.contextStrip.ring", { percent: formatter().percent(value.usage) })
  }

  return (
    <Show when={params.id && props.context.context()}>
      <IconButtonV2
        ref={props.context.setRing}
        type="button"
        data-action="context-ring"
        variant="ghost-muted"
        size="large"
        data-expanded={props.context.open() ? "" : undefined}
        aria-label={label()}
        aria-expanded={props.context.open()}
        aria-controls={props.context.id}
        onClick={props.context.toggle}
        icon={
          <span class="flex items-center justify-center">
            <ProgressCircleV2 percentage={props.context.context()?.usage ?? 0} />
          </span>
        }
      />
    </Show>
  )
}

/**
 * A slim strip on the composer's top edge with the thread's worktree and Git branch. The context ring
 * unfolds it upward, behind the composer, into a sheet with the context window's use.
 */
export function ComposerContextStrip(props: { context: ComposerContext }) {
  const sync = useSync()
  const sdk = useSDK()
  const layout = useLayout()
  const language = useLanguage()
  const { params, tabs, view } = useSessionLayout()

  const directory = () => (params.id ? sync().session.get(params.id)?.directory : undefined) ?? sdk().directory
  const worktree = createMemo(() => threadWorktree({ directory: directory(), project: sync().project }))
  const branch = () => (sync().project?.vcs === "git" ? sync().data.vcs?.branch : undefined)
  const visible = () => !!params.id && !!(worktree() || branch())
  const viewContext = () => {
    props.context.close()
    openSessionContext({ view: view(), layout, tabs: tabs() })
  }

  return (
    <Show when={visible()}>
      <div
        data-component="context-strip"
        class="relative h-[46px] w-full shrink-0"
        style={{ "margin-bottom": "-14px" }}
      >
        <section
          ref={props.context.setSheet}
          id={props.context.id}
          aria-label={language.t("secondBrain.contextStrip.sheet")}
          data-slot="context-sheet"
          data-open={props.context.open() ? "" : undefined}
          class="absolute inset-x-0 bottom-0 grid overflow-hidden rounded-t-[24px] bg-v2-background-bg-layer-01"
        >
          <div data-slot="context-sheet-body" class="min-h-0 overflow-hidden" inert={!props.context.open()}>
            <Show when={props.context.context()}>
              {(value) => (
                <SheetDetails
                  open={props.context.open()}
                  context={value()}
                  messages={props.context.messages()}
                  onView={viewContext}
                />
              )}
            </Show>
          </div>
          <div
            data-slot="context-strip-row"
            class="box-content flex h-8 min-w-0 items-center gap-4 px-5 pb-[14px] text-[12px] leading-4 text-v2-text-text-muted"
          >
            <Show when={worktree()}>
              {(value) => (
                <span
                  data-slot="context-strip-worktree"
                  class="flex min-w-0 shrink items-center gap-1.5"
                  title={directory()}
                >
                  <Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <Show when={value().linked}>
                    <span class="shrink-0">{language.t("secondBrain.contextStrip.worktree")}</span>
                  </Show>
                  <span class="min-w-0 truncate text-v2-text-text-base [font-weight:530]">{value().name}</span>
                </span>
              )}
            </Show>
            <Show when={branch()}>
              {(value) => (
                <span data-slot="context-strip-branch" class="flex min-w-0 shrink items-center gap-1.5">
                  <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="min-w-0 truncate font-mono text-v2-text-text-base" title={value()}>
                    {value()}
                  </span>
                </span>
              )}
            </Show>
          </div>
        </section>
      </div>
    </Show>
  )
}

function SheetDetails(props: {
  open: boolean
  context: NonNullable<ReturnType<ComposerContext["context"]>>
  messages: ReturnType<ComposerContext["messages"]>
  onView: () => void
}) {
  const language = useLanguage()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))
  const cost = createMemo(() => getSessionUsage(props.messages).cost)
  const limit = () => props.context.limit || undefined
  const rows = createMemo(() => contextTokenRows(props.context.message.tokens))
  // The arc and bars start empty and fill once the sheet is open; the transitions in the CSS animate them.
  const arc = () => (props.open ? Math.min(100, Math.max(0, props.context.usage ?? 0)) : 0)

  return (
    <div
      data-slot="context-sheet-details"
      class="grid grid-cols-[150px_minmax(0,1fr)] gap-x-5 gap-y-4 px-[18px] pt-4 text-[12px] leading-4 text-v2-text-text-muted"
    >
      <div data-slot="context-sheet-gauge" class="flex flex-col items-center">
        <Show
          when={limit()}
          fallback={
            <div class="flex h-20 flex-col items-center justify-end gap-1">
              <span class="text-[22px] leading-7 text-v2-text-text-base tabular-nums [font-weight:600]">
                {formatter().number(props.context.total)}
              </span>
              <span>{language.t("context.usage.tokens")}</span>
            </div>
          }
        >
          {(max) => (
            <>
              <div class="relative h-20 w-[140px]">
                <svg
                  role="img"
                  aria-label={language.t("secondBrain.contextStrip.gauge", {
                    percent: formatter().percent(props.context.usage),
                  })}
                  width="140"
                  height="80"
                  viewBox="0 0 140 80"
                  fill="none"
                >
                  <path
                    d="M14 74 A56 56 0 0 1 126 74"
                    pathLength="100"
                    stroke-width="12"
                    stroke-linecap="round"
                    data-slot="context-sheet-gauge-track"
                  />
                  <Show when={(props.context.usage ?? 0) > 0}>
                    <path
                      d="M14 74 A56 56 0 0 1 126 74"
                      pathLength="100"
                      stroke-width="12"
                      stroke-linecap="round"
                      stroke-dasharray="100 101"
                      stroke-dashoffset={100 - arc()}
                      data-slot="context-sheet-gauge-fill"
                    />
                  </Show>
                </svg>
                <span
                  aria-hidden="true"
                  class="absolute inset-x-0 bottom-0.5 text-center text-[26px] leading-8 text-v2-text-text-base tabular-nums [font-weight:600]"
                >
                  {formatter().percent(props.context.usage)}
                </span>
              </div>
              <span class="mt-1.5 tabular-nums">
                {language.t("secondBrain.sessionTab.contextUsed", {
                  used: formatter().number(props.context.total),
                  limit: formatter().number(max()),
                })}
              </span>
              <Show when={max() >= props.context.total}>
                <span class="mt-0.5 tabular-nums text-v2-text-text-base">
                  {language.t("secondBrain.contextStrip.left", {
                    count: formatter().number(max() - props.context.total),
                  })}
                </span>
              </Show>
            </>
          )}
        </Show>
      </div>
      <div class="flex min-w-0 flex-col gap-[9px] pt-0.5">
        <Index each={rows()}>
          {(row) => (
            <div
              data-slot="context-sheet-row"
              class="grid items-center gap-x-2.5"
              classList={{
                "grid-cols-[82px_minmax(0,1fr)_54px_38px]": !!limit(),
                "grid-cols-[minmax(0,1fr)_auto]": !limit(),
              }}
            >
              <span class="truncate">{language.t(TOKEN_LABEL[row().key])}</span>
              <Show when={limit()}>
                {(max) => (
                  <span data-slot="context-sheet-bar-track" class="h-2 overflow-hidden rounded-full">
                    <span
                      data-slot="context-sheet-bar"
                      class="block h-full rounded-full"
                      style={{
                        width: `max(3px, ${Math.min(100, (row().value / max()) * 100)}%)`,
                        transform: props.open ? "scaleX(1)" : "scaleX(0)",
                      }}
                    />
                  </span>
                )}
              </Show>
              <span class="text-right tabular-nums text-v2-text-text-base [font-weight:600]">
                {formatter().number(row().value)}
              </span>
              <Show when={limit()}>
                {(max) => (
                  <span class="text-right tabular-nums">{formatShare(row().value, max(), language.intl())}</span>
                )}
              </Show>
            </div>
          )}
        </Index>
        <div class="flex min-w-0 items-center gap-3 border-t border-v2-border-border-muted pt-1.5">
          <span class="min-w-0 truncate font-mono" title={props.context.modelLabel}>
            {props.context.modelLabel}
          </span>
          <Show when={cost()}>
            {(amount) => (
              <span class="shrink-0 tabular-nums">
                {language.t("secondBrain.contextStrip.cost", { amount: usd().format(amount()) })}
              </span>
            )}
          </Show>
          <ButtonV2 variant="ghost-muted" size="small" class="ml-auto shrink-0" onClick={props.onView}>
            {language.t("context.usage.view")}
          </ButtonV2>
        </div>
      </div>
      <div aria-hidden="true" class="col-span-full h-px bg-v2-border-border-muted" />
    </div>
  )
}
