import { fileURLToPath } from "node:url"

export function resolveExternalURL(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") return url.href
  return undefined
}

export function resolveLocalFilePath(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== "file:" || url.hostname) return undefined
  try {
    return fileURLToPath(url)
  } catch {
    return undefined
  }
}

export const unparseableURL = "<unparseable>"

// Log-safe form of a URL: scheme and host only, never the path, query string,
// hash, or credentials,
// because the server accepts an `auth_token` query parameter.
export function redactURL(value: string) {
  if (!URL.canParse(value)) return unparseableURL
  const url = new URL(value)
  return url.host ? `${url.protocol}//${url.host}` : url.protocol
}

// Subframes are the sandboxed srcdoc documents the renderer builds (agent-drawn designs and
// diagrams in chat). A sandboxed frame can still navigate itself, which would load a page outside
// its CSP, so a subframe may only (re)load its own inline document.
export function isSubframeDocumentURL(value: string) {
  return value === "about:blank" || value === "about:srcdoc" || value.startsWith("about:srcdoc#")
}
