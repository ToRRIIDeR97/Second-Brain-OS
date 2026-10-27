import { createEffect, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { render } from "solid-js/web"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import type { UiI18n } from "@opencode-ai/ui/context/i18n"
import type { FileReferenceActions } from "../context/file-reference"
import {
  fileReferenceRangeLabel,
  parseFileReference,
  resolveFileReferencePath,
  type FileReference,
} from "./markdown-file-reference"

export type FileReferenceLabels = {
  open: string
  copy: string
  copied: string
  loading: string
  missing: string
  binary: string
  empty: string
  more: (count: number) => string
}

export function fileReferenceLabels(i18n: UiI18n): FileReferenceLabels {
  return {
    open: i18n.t("secondBrain.fileReference.open"),
    copy: i18n.t("secondBrain.fileReference.copyPath"),
    copied: i18n.t("ui.message.copied"),
    loading: i18n.t("secondBrain.fileReference.loading"),
    missing: i18n.t("secondBrain.fileReference.missing"),
    binary: i18n.t("secondBrain.fileReference.binary"),
    empty: i18n.t("secondBrain.fileReference.empty"),
    more: (count) => i18n.plural("secondBrain.fileReference.more", count, { count }),
  }
}

const SHOW_DELAY = 300
const HIDE_DELAY = 150
const PREVIEW_LINES = 12
const LINE_CHARS = 240
const chipSelector = "code[data-file-reference]"
const chipAttributes = [
  "data-file-reference",
  "data-file-reference-start",
  "data-file-reference-end",
  "role",
  "tabindex",
]

/**
 * Marks inline code that cites a file inside `directory` as a focusable link chip. The resolved
 * relative path and range live in data attributes so the delegated handlers never re-parse.
 */
export function markFileReferences(root: Element, directory: string | undefined) {
  root.querySelectorAll<HTMLElement>(":not(pre) > code").forEach((code) => {
    const reference = directory && !code.closest("a") ? parseFileReference(code.textContent ?? "") : undefined
    const path = reference && resolveFileReferencePath(reference.path, directory!)
    if (!reference || !path) {
      if (!code.hasAttribute("data-file-reference")) return
      chipAttributes.forEach((name) => code.removeAttribute(name))
      return
    }
    code.dataset.fileReference = path
    code.setAttribute("role", "button")
    code.tabIndex = 0
    if (!reference.start || !reference.end) return
    code.dataset.fileReferenceStart = String(reference.start)
    code.dataset.fileReferenceEnd = String(reference.end)
  })
}

function chipReference(chip: HTMLElement): FileReference {
  const start = Number(chip.dataset.fileReferenceStart) || undefined
  const end = Number(chip.dataset.fileReferenceEnd) || start
  return { path: chip.dataset.fileReference!, start, end }
}

/** Delegated hover peek and open handling for the chips under `root`. Returns its cleanup. */
export function setupFileReferences(
  root: HTMLElement,
  actions: () => FileReferenceActions | undefined,
  labels: () => FileReferenceLabels,
) {
  const [target, setTarget] = createSignal<{ chip: HTMLElement; reference: FileReference }>()
  const [placement, setPlacement] = createSignal(0)
  let host: HTMLDivElement | undefined
  let dispose: (() => void) | undefined
  let showTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const chipFrom = (node: EventTarget | null) => {
    if (!(node instanceof Element)) return
    const chip = node.closest<HTMLElement>(chipSelector)
    if (!chip || !root.contains(chip)) return
    return chip
  }
  const inPeek = (node: EventTarget | null) => node instanceof Node && !!host?.contains(node)
  const clearTimers = () => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
  }

  const show = (chip: HTMLElement) => {
    clearTimers()
    const current = actions()
    if (!current) return
    if (target()?.chip === chip) return
    if (!host) {
      host = document.createElement("div")
      document.body.appendChild(host)
      dispose = render(
        () => (
          <FileReferencePeek
            target={target()}
            placement={placement()}
            actions={actions}
            labels={labels}
            onOpen={(reference) => {
              hide()
              actions()?.onFileReference(reference)
            }}
            onEnter={clearTimers}
            onLeave={scheduleHide}
            onDismiss={() => {
              const chip = target()?.chip
              hide()
              chip?.focus()
            }}
          />
        ),
        host,
      )
    }
    setTarget({ chip, reference: chipReference(chip) })
  }
  const hide = () => {
    clearTimers()
    setTarget(undefined)
  }
  const scheduleHide = () => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, HIDE_DELAY)
  }
  const open = (chip: HTMLElement) => {
    hide()
    actions()?.onFileReference(chipReference(chip))
  }

  const onPointerOver = (event: PointerEvent) => {
    const chip = chipFrom(event.target)
    if (!chip) return
    clearTimeout(hideTimer)
    if (target()?.chip === chip) return
    clearTimeout(showTimer)
    showTimer = setTimeout(() => show(chip), SHOW_DELAY)
  }
  const onPointerOut = (event: PointerEvent) => {
    const chip = chipFrom(event.target)
    const next = event.relatedTarget
    if (!chip || (next instanceof Node && chip.contains(next)) || inPeek(next)) return
    if (target()) scheduleHide()
    else clearTimeout(showTimer)
  }
  // Pointer clicks focus the chip too; only keyboard focus opens the peek straight away.
  const onFocusIn = (event: FocusEvent) => {
    const chip = chipFrom(event.target)
    if (chip?.matches(":focus-visible")) show(chip)
  }
  const onFocusOut = (event: FocusEvent) => {
    if (!chipFrom(event.target) || inPeek(event.relatedTarget)) return
    hide()
  }
  const onClick = (event: MouseEvent) => {
    const chip = chipFrom(event.target)
    if (!chip || !actions()) return
    // Dragging across a chip to select its text should not open the panel.
    if (window.getSelection()?.isCollapsed === false) return
    event.preventDefault()
    open(chip)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const chip = chipFrom(event.target)
    if (!chip) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      open(chip)
      return
    }
    if (event.key === "Escape" && target()) {
      event.stopPropagation()
      hide()
      return
    }
    if (event.key === "ArrowDown" && target()?.chip === chip) {
      event.preventDefault()
      host?.querySelector<HTMLElement>("button")?.focus()
    }
  }
  // The timeline scrolls while replies stream, so follow the chip and only close once it is gone.
  const onViewportChange = (event: Event) => {
    const chip = target()?.chip
    if (!chip || inPeek(event.target)) return
    const rect = chip.getBoundingClientRect()
    if (!chip.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) {
      hide()
      return
    }
    setPlacement((count) => count + 1)
  }

  root.addEventListener("pointerover", onPointerOver)
  root.addEventListener("pointerout", onPointerOut)
  root.addEventListener("focusin", onFocusIn)
  root.addEventListener("focusout", onFocusOut)
  root.addEventListener("click", onClick)
  root.addEventListener("keydown", onKeyDown)
  window.addEventListener("scroll", onViewportChange, true)
  window.addEventListener("resize", onViewportChange)

  return () => {
    clearTimers()
    root.removeEventListener("pointerover", onPointerOver)
    root.removeEventListener("pointerout", onPointerOut)
    root.removeEventListener("focusin", onFocusIn)
    root.removeEventListener("focusout", onFocusOut)
    root.removeEventListener("click", onClick)
    root.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("scroll", onViewportChange, true)
    window.removeEventListener("resize", onViewportChange)
    dispose?.()
    host?.remove()
  }
}

function FileReferencePeek(props: {
  target?: { chip: HTMLElement; reference: FileReference }
  placement: number
  actions: () => FileReferenceActions | undefined
  labels: () => FileReferenceLabels
  onOpen: (reference: FileReference) => void
  onEnter: () => void
  onLeave: () => void
  onDismiss: () => void
}) {
  const [preview] = createResource(
    () => props.target?.reference,
    (reference) => {
      const actions = props.actions()
      if (!actions) return { status: "missing" as const, path: reference.path }
      return actions
        .readFileRange(reference, PREVIEW_LINES)
        .catch(() => ({ status: "missing" as const, path: reference.path }))
    },
  )
  const [copied, setCopied] = createSignal(false)
  let element: HTMLDivElement | undefined
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  const reference = () => props.target?.reference
  // While the next reference loads, `latest` still holds the previous one's result.
  const result = () => (preview.loading ? undefined : preview.latest)
  const found = () => {
    const value = result()
    if (value?.status === "found") return value
  }
  // A bare file name shows its full path once the app has found it.
  const path = () => result()?.path ?? reference()?.path ?? ""
  const name = () => path().split("/").at(-1) ?? ""
  const folder = () => path().split("/").slice(0, -1).join("/")
  const hidden = () => {
    const value = found()
    const current = reference()
    if (!value || !current?.end) return 0
    return Math.max(0, current.end - value.start + 1 - value.lines.length)
  }

  // Below the chip, or above it when the viewport has no room; re-placed when the content settles or
  // the page scrolls. A new chip hides the peek until measured, so it never shows at the old spot.
  let placedChip: HTMLElement | undefined
  createEffect(() => {
    const target = props.target
    void props.placement
    void preview.state
    if (!target || !element) return
    if (placedChip !== target.chip) delete element.dataset.placed
    const frame = requestAnimationFrame(() => {
      if (!element) return
      const anchor = target.chip.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const below = anchor.bottom + 6
      const top = below + box.height > window.innerHeight - 8 ? Math.max(8, anchor.top - 6 - box.height) : below
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))
      element.style.top = `${top}px`
      element.style.left = `${left}px`
      element.dataset.placed = ""
      placedChip = target.chip
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })

  onCleanup(() => clearTimeout(copiedTimer))

  const copy = async () => {
    const clipboard = navigator?.clipboard
    if (!path() || !clipboard) return
    await clipboard.writeText(path())
    setCopied(true)
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Show when={reference()}>
      {(current) => (
        <div
          ref={element}
          data-component="file-reference-peek"
          role="dialog"
          aria-label={path()}
          onPointerEnter={props.onEnter}
          onPointerLeave={props.onLeave}
          onFocusOut={(event) => {
            const next = event.relatedTarget
            if (next instanceof Node && (element?.contains(next) || props.target?.chip.contains(next))) return
            props.onLeave()
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.stopPropagation()
            props.onDismiss()
          }}
        >
          <div data-slot="file-reference-peek-header">
            <span data-slot="file-reference-peek-name">{name()}</span>
            <Show when={folder()}>
              <span data-slot="file-reference-peek-folder">{folder()}</span>
            </Show>
            <Show when={fileReferenceRangeLabel(current())}>
              {(label) => <span data-slot="file-reference-peek-range">{label()}</span>}
            </Show>
          </div>
          <Switch>
            <Match when={found()}>
              {(value) => (
                <Show
                  when={value().lines.length > 0}
                  fallback={<div data-slot="file-reference-peek-status">{props.labels().empty}</div>}
                >
                  <div data-slot="file-reference-peek-lines">
                    <For each={value().lines}>
                      {(line, index) => (
                        <div data-slot="file-reference-peek-line">
                          <span data-slot="file-reference-peek-number">{value().start + index()}</span>
                          <span data-slot="file-reference-peek-text">{line.slice(0, LINE_CHARS)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={hidden() > 0}>
                    <div data-slot="file-reference-peek-more">{props.labels().more(hidden())}</div>
                  </Show>
                </Show>
              )}
            </Match>
            <Match when={preview.loading}>
              <div data-slot="file-reference-peek-status" role="status">
                {props.labels().loading}
              </div>
            </Match>
            <Match when={result()?.status === "binary"}>
              <div data-slot="file-reference-peek-status">{props.labels().binary}</div>
            </Match>
            <Match when={true}>
              <div data-slot="file-reference-peek-status" data-missing="">
                {props.labels().missing}
              </div>
            </Match>
          </Switch>
          <div data-slot="file-reference-peek-actions">
            <Show when={result()?.status !== "missing"}>
              <ButtonV2 size="small" variant="ghost" icon="filetree" onClick={() => props.onOpen(current())}>
                {props.labels().open}
              </ButtonV2>
            </Show>
            <ButtonV2 size="small" variant="ghost" icon={copied() ? "check" : "outline-copy"} onClick={copy}>
              {copied() ? props.labels().copied : props.labels().copy}
            </ButtonV2>
          </div>
        </div>
      )}
    </Show>
  )
}
