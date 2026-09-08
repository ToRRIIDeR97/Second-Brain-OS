import { extname } from "node:path"
import { fileURLToPath } from "node:url"

const executableExtensions = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".command",
  ".desktop",
  ".exe",
  ".jar",
  ".js",
  ".mjs",
  ".cjs",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".vbe",
  ".vbs",
  ".wsf",
  ".wsh",
])

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
    const path = fileURLToPath(url)
    return executableExtensions.has(extname(path).toLowerCase()) ? undefined : path
  } catch {
    return undefined
  }
}
