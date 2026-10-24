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
