import DOMPurify from "dompurify"

/**
 * Renders a completed ```svg fenced block as an inline diagram window.
 *
 * Agent output is untrusted: the markup is sanitized with DOMPurify's SVG profile (no scripts,
 * event handlers or links) and then shown in an iframe with an empty `sandbox` and a CSP that
 * blocks every network load, so a diagram cannot run code, navigate or reach the network.
 * SVG <style> rules stay inside the iframe instead of leaking into the app.
 */

export type SvgWindowLabels = {
  title: string
  preview: string
  source: string
  download: string
}

export type SvgTheme = {
  fg: string
  muted: string
  accent: string
  surface: string
  border: string
  font: string
  scheme: string
}

type Mounted = { source: string; markup?: string }

const MAX_HEIGHT = 640
const FALLBACK_HEIGHT = 360
const mounted = new WeakMap<HTMLElement, Mounted>()

const themeTokens: Record<Exclude<keyof SvgTheme, "font" | "scheme">, string> = {
  fg: "--v2-text-text-base",
  muted: "--v2-text-text-muted",
  accent: "--v2-text-text-accent",
  surface: "--v2-background-bg-layer-01",
  border: "--v2-border-border-base",
}

/** Intrinsic size from a viewBox, else from numeric (or px) width and height attributes. */
export function svgSize(attrs: { viewBox?: string | null; width?: string | null; height?: string | null }) {
  const box = attrs.viewBox?.trim().split(/[\s,]+/).map(Number)
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]!, viewBox: true }
  const width = length(attrs.width)
  const height = length(attrs.height)
  if (width && height) return { width, height, viewBox: false }
}

function length(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(px)?$/)
  const result = match ? Number(match[1]) : NaN
  return result > 0 ? result : undefined
}

/** The iframe document: a strict CSP, theme variables for the diagram, and the sanitized markup. */
export function svgDocument(markup: string, theme: SvgTheme) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"
  const vars = [
    `--tenon-fg:${theme.fg}`,
    `--tenon-muted:${theme.muted}`,
    `--tenon-accent:${theme.accent}`,
    `--tenon-surface:${theme.surface}`,
    `--tenon-border:${theme.border}`,
  ].join(";")
  const font = theme.font.replace(/[<>;{}]/g, "")
  // A color-scheme that differs from the app's gives the iframe an opaque canvas.
  const scheme = /^(normal|light|dark)$/.test(theme.scheme) ? theme.scheme : "normal"
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<style>:root{${vars};color-scheme:${scheme}}html,body{margin:0;height:100%;overflow:hidden;background:transparent;`,
    `color:var(--tenon-fg);font-family:${font}}body>svg{display:block;width:100%;height:100%}</style>`,
    `</head><body>${markup}</body></html>`,
  ].join("")
}

/** Sanitized, standalone SVG markup plus its intrinsic size, or undefined when there is no <svg>. */
export function sanitizeSvg(source: string) {
  if (typeof document === "undefined" || !DOMPurify.isSupported) return
  const fragment = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["a", "foreignObject", "script"],
    FORBID_ATTR: ["target"],
    ADD_ATTR: ["dominant-baseline"],
    // DOMPurify's default pattern without its URL schemes, so values like https://… are dropped;
    // data: images still pass through DOMPurify's own data-URI rule. The CSP blocks the rest.
    ALLOWED_URI_REGEXP: /^(?:[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    RETURN_DOM_FRAGMENT: true,
  })
  const svg = fragment.querySelector("svg")
  if (!svg) return
  const size = svgSize({
    viewBox: svg.getAttribute("viewBox"),
    width: svg.getAttribute("width"),
    height: svg.getAttribute("height"),
  })
  if (size && !size.viewBox) svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`)
  const explicitWidth = length(svg.getAttribute("width"))
  return { markup: new XMLSerializer().serializeToString(svg), size, explicitWidth }
}

function readTheme(host: HTMLElement): SvgTheme {
  const probe = document.createElement("span")
  probe.style.display = "none"
  host.appendChild(probe)
  const resolve = (token: string) => {
    probe.style.color = `var(${token})`
    return getComputedStyle(probe).color
  }
  const theme = {
    fg: resolve(themeTokens.fg),
    muted: resolve(themeTokens.muted),
    accent: resolve(themeTokens.accent),
    surface: resolve(themeTokens.surface),
    border: resolve(themeTokens.border),
    font: getComputedStyle(host).fontFamily,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }
  probe.remove()
  return theme
}

function button(label: string, action: string) {
  const el = document.createElement("button")
  el.type = "button"
  el.dataset.action = action
  el.textContent = label
  return el
}

function unmount(wrapper: HTMLElement) {
  wrapper.querySelector(':scope > [data-slot="svg-window-bar"]')?.remove()
  wrapper.querySelector(':scope > [data-slot="svg-window-frame"]')?.remove()
  delete wrapper.dataset.svgWindow
  mounted.delete(wrapper)
}

function download(markup: string) {
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }))
  const link = document.createElement("a")
  link.href = url
  link.download = "diagram.svg"
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function mount(wrapper: HTMLElement, pre: HTMLElement, source: string, labels: SvgWindowLabels) {
  unmount(wrapper)
  const result = sanitizeSvg(source)
  mounted.set(wrapper, { source, markup: result?.markup })
  if (!result) return

  const frame = document.createElement("iframe")
  frame.dataset.slot = "svg-window-frame"
  frame.setAttribute("sandbox", "")
  frame.setAttribute("referrerpolicy", "no-referrer")
  frame.setAttribute("loading", "lazy")
  frame.title = labels.title
  frame.style.aspectRatio = result.size ? `${result.size.width} / ${result.size.height}` : ""
  frame.style.height = result.size ? "auto" : `${FALLBACK_HEIGHT}px`
  frame.style.maxHeight = `${MAX_HEIGHT}px`
  if (result.explicitWidth) frame.style.maxWidth = `${result.explicitWidth}px`
  frame.srcdoc = svgDocument(result.markup, readTheme(wrapper))

  const bar = document.createElement("div")
  bar.dataset.slot = "svg-window-bar"
  const title = document.createElement("span")
  title.textContent = labels.title
  const toggle = button(labels.source, "toggle")
  const save = button(labels.download, "download")
  toggle.addEventListener("click", () => {
    const showing = wrapper.dataset.svgWindow === "source"
    wrapper.dataset.svgWindow = showing ? "preview" : "source"
    toggle.textContent = showing ? labels.source : labels.preview
  })
  save.addEventListener("click", () => download(result.markup))
  bar.append(title, toggle, save)

  wrapper.dataset.svgWindow = "preview"
  wrapper.insertBefore(bar, pre)
  wrapper.insertBefore(frame, pre)
}

/** Mounts a window on every completed ```svg block under `root`; open (streaming) blocks stay as code. */
export function mountSvgWindows(root: HTMLElement, labels: SvgWindowLabels) {
  for (const code of root.querySelectorAll<HTMLElement>("pre > code.language-svg")) {
    const pre = code.parentElement
    const wrapper = pre?.parentElement
    if (!pre || !wrapper || wrapper.dataset.component !== "markdown-code") continue
    const complete = wrapper.closest<HTMLElement>("[data-markdown-block]")?.dataset.markdownComplete !== "false"
    if (!complete) {
      if (mounted.has(wrapper)) unmount(wrapper)
      continue
    }
    const source = code.textContent ?? ""
    const current = mounted.get(wrapper)
    const present = !current?.markup || wrapper.querySelector(':scope > [data-slot="svg-window-frame"]')
    if (current?.source === source && present) continue
    mount(wrapper, pre, source, labels)
  }
}
