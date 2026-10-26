import type { DesignSpace } from "../context/design"
import {
  DESIGN_SANDBOX,
  designDocument,
  designFences,
  designID,
  designInfo,
  designTooLarge,
  type Design,
  type DesignInfo,
} from "./design-fence"

/**
 * Renders ```html fenced blocks as designs (see design-fence.ts for the format and trust model).
 *
 * A small design becomes an inline window running the page in a sandboxed iframe; a canvas design
 * becomes a compact card that opens the Canvas tab. While a fence streams it shows a placeholder,
 * so the iframe is built once, when the fence closes, instead of on every token.
 */

export type HtmlWindowLabels = {
  title: string
  badge: string
  use: string
  open: string
  source: string
  preview: string
  streaming: string
  tooLarge: string
  card: (title: string) => string
}

type Options = {
  space?: DesignSpace
  /** True when the message streamed in this view, so a finished canvas block is announced. */
  live: boolean
}

const MIN_HEIGHT = 48
const MAX_HEIGHT = 720
const INITIAL_HEIGHT = 160
const mounted = new WeakMap<HTMLElement, string>()

/** Mounts a design on every ```html block under `root`; `raw` is the markdown those blocks came from. */
export function mountHtmlWindows(root: HTMLElement, raw: string, labels: HtmlWindowLabels, options: Options) {
  const codes = root.querySelectorAll<HTMLElement>("pre > code.language-html")
  if (codes.length === 0) return
  // Parsed lazily: only a completed block needs the fence list, and only once.
  let fences: ReturnType<typeof designFences> | undefined
  for (const code of codes) {
    const pre = code.parentElement
    const wrapper = pre?.parentElement
    if (!pre || !wrapper || wrapper.dataset.component !== "markdown-code") continue
    const complete = wrapper.closest<HTMLElement>("[data-markdown-block]")?.dataset.markdownComplete !== "false"
    if (!complete) {
      const info = streamingInfo(raw)
      const key = `streaming:${info.canvas}:${info.title ?? ""}`
      if (mounted.get(wrapper) === key) continue
      mount(wrapper, pre, { ...info, id: "", source: "" }, labels, options, true)
      mounted.set(wrapper, key)
      continue
    }
    const source = code.textContent ?? ""
    const id = designID(source)
    fences ??= designFences(raw)
    const info: DesignInfo = fences.find((fence) => fence.closed && designID(fence.source) === id) ?? { canvas: false }
    const key = `done:${id}:${info.canvas}:${info.title ?? ""}`
    const previous = mounted.get(wrapper)
    if (
      previous === key &&
      wrapper.querySelector(':scope > [data-slot="html-window-bar"], :scope > [data-slot="html-window-card"]')
    )
      continue
    const design = { id, title: info.title, source, canvas: info.canvas }
    mount(wrapper, pre, design, labels, options, false)
    mounted.set(wrapper, key)
    if (options.live && design.canvas && previous !== key) options.space?.reveal?.(design)
  }
}

/** Title and kind of the fence still streaming: the opening line of a code block, else the last open fence. */
function streamingInfo(raw: string): DesignInfo {
  const head = raw
    .trimStart()
    .split("\n", 1)[0]
    .match(/^(`{3,}|~{3,})(.*)$/)
  if (head) return designInfo(head[2])
  return designFences(raw).findLast((fence) => !fence.closed) ?? { canvas: false }
}

function mount(
  wrapper: HTMLElement,
  pre: HTMLElement,
  design: Design,
  labels: HtmlWindowLabels,
  options: Options,
  streaming: boolean,
) {
  unmount(wrapper)
  listen()
  const title = design.title ?? labels.title
  const large = !streaming && designTooLarge(design.source)
  wrapper.dataset.htmlWindow = design.canvas ? "card" : "window"

  if (design.canvas) {
    const card = element("div", "html-window-card")
    const name = element("span", "html-window-title")
    name.textContent = labels.card(title)
    card.append(name)
    if (streaming || large) {
      const status = element("span", "html-window-status")
      status.textContent = streaming ? labels.streaming : labels.tooLarge
      card.append(status)
    }
    if (!streaming && !large && options.space?.open)
      card.append(button(labels.open, () => options.space?.open?.(design)))
    wrapper.insertBefore(card, pre)
    return
  }

  const bar = element("div", "html-window-bar")
  const name = element("span", "html-window-title")
  name.textContent = title
  const badge = element("span", "html-window-badge")
  badge.textContent = labels.badge
  bar.append(name, badge)
  wrapper.insertBefore(bar, pre)

  if (streaming || large) {
    const notice = element("div", "html-window-notice")
    notice.textContent = streaming ? labels.streaming : labels.tooLarge
    if (streaming) notice.dataset.streaming = ""
    wrapper.insertBefore(notice, pre)
    return
  }

  // The page source stays one click away: ```html is also how agents show plain markup.
  const toggle = button(labels.source, () => {
    const showing = wrapper.dataset.htmlWindow === "source"
    wrapper.dataset.htmlWindow = showing ? "window" : "source"
    toggle.textContent = showing ? labels.source : labels.preview
  })
  bar.append(toggle)
  wrapper.insertBefore(frame(design.source, title), pre)
  const footer = element("div", "html-window-footer")
  if (options.space?.use) footer.append(button(labels.use, () => options.space?.use?.(design)))
  if (options.space?.open) footer.append(button(labels.open, () => options.space?.open?.(design)))
  if (footer.childElementCount > 0) wrapper.insertBefore(footer, pre)
}

function frame(source: string, title: string) {
  const el = document.createElement("iframe")
  el.dataset.slot = "html-window-frame"
  // Set before srcdoc and before the frame is attached, so the first load is already sandboxed.
  el.setAttribute("sandbox", DESIGN_SANDBOX)
  el.setAttribute("referrerpolicy", "no-referrer")
  el.setAttribute("loading", "lazy")
  el.title = title
  el.style.height = `${INITIAL_HEIGHT}px`
  el.srcdoc = designDocument(source, { autosize: true })
  return el
}

function unmount(wrapper: HTMLElement) {
  wrapper
    .querySelectorAll(
      ':scope > [data-slot="html-window-bar"], :scope > [data-slot="html-window-frame"], :scope > [data-slot="html-window-notice"], :scope > [data-slot="html-window-footer"], :scope > [data-slot="html-window-card"]',
    )
    .forEach((el) => el.remove())
  delete wrapper.dataset.htmlWindow
  mounted.delete(wrapper)
}

function element(tag: "div" | "span", slot: string) {
  const el = document.createElement(tag)
  el.dataset.slot = slot
  return el
}

function button(label: string, onClick: () => void) {
  const el = document.createElement("button")
  el.type = "button"
  el.textContent = label
  el.addEventListener("click", onClick)
  return el
}

let listening = false

/**
 * The only message the app accepts from a design frame: its content height as a bare number, from
 * the frame's own window (an opaque origin). Anything else is ignored; nothing is sent back.
 */
function listen() {
  if (listening) return
  listening = true
  window.addEventListener("message", (event) => {
    if (event.origin !== "null" || typeof event.data !== "number" || !Number.isFinite(event.data)) return
    const target = Array.from(
      document.querySelectorAll<HTMLIFrameElement>('iframe[data-slot="html-window-frame"]'),
    ).find((el) => el.contentWindow === event.source)
    if (!target) return
    target.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(event.data)))}px`
  })
}
