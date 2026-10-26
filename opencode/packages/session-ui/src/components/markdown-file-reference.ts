import { hasPathExtension, hasPathFileName, inlineCodeKind } from "./markdown-inline-code-kind"

/** A file cited in inline code, e.g. `core/src/harness.ts:1552-1556`. Lines are 1-based and inclusive. */
export type FileReference = {
  path: string
  start?: number
  end?: number
}

// `path`, `path:10`, `path:10-20`, `path:10:4` (column ignored), `path#L10`, `path#L10-L20`.
const referencePattern = /^(.+?)(?::(\d{1,7})(?:-(\d{1,7})|:\d{1,7})?|#L(\d{1,7})(?:-L?(\d{1,7}))?)?$/

/**
 * Parses inline code that cites a file, optionally with a line range. Only names that look like a
 * file (a known extension or file name) qualify, so directories and dotted identifiers stay plain code.
 */
export function parseFileReference(text: string): FileReference | undefined {
  const match = referencePattern.exec(text.trim())
  if (!match) return
  const path = match[1]
  if (inlineCodeKind(path) !== "path") return
  if (path.endsWith("/") || path.endsWith("\\")) return
  const name = path.split(/[/\\]/).at(-1)!
  if (!hasPathExtension(name) && !hasPathFileName(name)) return
  const start = Number(match[2] ?? match[4] ?? 0)
  const end = Number(match[3] ?? match[5] ?? start)
  if (start < 1) return { path }
  return { path, start, end: end >= start ? end : start }
}

/**
 * Returns `input` as a normalized path relative to `directory`, or undefined when it can leave it:
 * any `..` segment, a home-relative path, or an absolute path outside the directory.
 * Absolute paths inside the directory become relative.
 */
export function resolveFileReferencePath(input: string, directory: string) {
  if (!input || !directory || /[\u0000-\u001f]/.test(input)) return
  if (input.startsWith("~")) return
  const windows = /^[A-Za-z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
  const value = windows ? input.replaceAll("\\", "/") : input
  const relative = absolute(value) ? inside(value, directory, windows) : value
  if (relative === undefined) return
  const segments = relative.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.includes("..")) return
  return segments.join("/")
}

function absolute(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path)
}

function inside(path: string, directory: string, windows: boolean) {
  const root = (windows ? directory.replaceAll("\\", "/") : directory).replace(/\/+$/, "")
  // Windows paths compare case-insensitively; slice the original so the relative path keeps its case.
  const canon = (value: string) => (windows ? value.toLowerCase() : value)
  if (!root) return path.slice(1)
  if (!canon(path).startsWith(canon(root) + "/")) return
  return path.slice(root.length + 1)
}

/** `L27`, or `L27–29` for a range. */
export function fileReferenceRangeLabel(reference: Pick<FileReference, "start" | "end">) {
  if (!reference.start) return ""
  if (!reference.end || reference.end === reference.start) return `L${reference.start}`
  return `L${reference.start}–${reference.end}`
}
