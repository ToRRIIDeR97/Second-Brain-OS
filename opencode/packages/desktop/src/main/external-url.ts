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
