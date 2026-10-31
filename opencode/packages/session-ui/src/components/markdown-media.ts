/**
 * Markdown from notes, models and providers is untrusted. A remote image or media URL would load
 * as soon as the text renders and tell its host when and where it was read, so only inline
 * (`data:`) and in-memory (`blob:`) sources are kept.
 */
export function isLocalMediaSource(value: string) {
  return /^\s*(?:data|blob):/i.test(value)
}

const mediaAttributes = ["src", "srcset", "poster"] as const

/** Remove every non-local source from a media element (`img`, `source`, `video`, `audio`, `input`). */
export function stripRemoteMedia(node: Element) {
  if (!["IMG", "SOURCE", "VIDEO", "AUDIO", "INPUT", "TRACK"].includes(node.tagName)) return
  for (const attribute of mediaAttributes) {
    const value = node.getAttribute(attribute)
    if (value !== null && (attribute === "srcset" || !isLocalMediaSource(value))) node.removeAttribute(attribute)
  }
}

type StyledElement = {
  readonly style?: {
    readonly length: number
    readonly [index: number]: string
    getPropertyValue(property: string): string
    removeProperty(property: string): string
  }
  hasAttribute(name: string): boolean
  removeAttribute(name: string): void
}

// Highlighted code needs inline colours; nothing in rendered Markdown needs layout. Raw HTML in model
// output or notes could otherwise position itself over the app shell.
const allowedStyle = /^(?:color|background-color|font-style|font-weight|text-decoration(?:-[a-z]+)?|--shiki-[\w-]+)$/

export function restrictStyle(node: StyledElement) {
  const style = node.style
  if (!style || !node.hasAttribute("style")) return
  const properties = Array.from({ length: style.length }, (_, index) => style[index])
  for (const property of properties) {
    if (!allowedStyle.test(property) || /url\(/i.test(style.getPropertyValue(property)))
      style.removeProperty(property)
  }
  if (!style.length) node.removeAttribute("style")
}
