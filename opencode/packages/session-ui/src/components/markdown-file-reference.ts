import { hasPathExtension, hasPathFileName, inlineCodeKind } from "./markdown-inline-code-kind"

/**
 * A file or folder cited in inline code, e.g. `core/src/harness.ts:1552-1556` or `notes/`. Lines are
 * 1-based and inclusive. `kind` is `folder` for a trailing slash and `either` for an extensionless path,
 * which the folder listing settles when the reference is hovered or opened; without it, the path names a file.
 */
export type FileReference = {
  path: string
  start?: number
  end?: number
  kind?: "folder" | "either"
}

// `path`, `path:10`, `path:10-20`, `path:10:4` (column ignored), `path#L10`, `path#L10-L20`.
const referencePattern = /^(.+?)(?::(\d{1,7})(?:-(\d{1,7})|:\d{1,7})?|#L(\d{1,7})(?:-L?(\d{1,7}))?)?$/

/**
 * Parses inline code that cites a file, optionally with a line range, or a folder. A known extension or
 * file name marks a file and a trailing slash a folder. Any other path the classifier accepts has a slash
 * and no extension, so it may be either; a line range makes it a file. Dotted identifiers stay plain code.
 */
export function parseFileReference(text: string): FileReference | undefined {
  const match = referencePattern.exec(text.trim())
  if (!match) return
  const path = match[1]
  if (inlineCodeKind(path) !== "path") return
  const start = Number(match[2] ?? match[4] ?? 0)
  const end = Number(match[3] ?? match[5] ?? start)
  if (/[/\\]$/.test(path)) return start ? undefined : { path, kind: "folder" }
  const name = path.split(/[/\\]/).at(-1)!
  const file = hasPathExtension(name) || hasPathFileName(name)
  if (start < 1) return file ? { path } : { path, kind: "either" }
  return { path, start, end: end >= start ? end : start }
}

/**
 * Returns `input` as a normalized path relative to `directory`, or undefined when it can leave it:
 * any `..` segment, a home-relative or Windows drive-relative path (`D:x.ts`, which resolves against
 * that drive's current folder), or an absolute path outside the directory.
 * Absolute paths inside the directory become relative.
 */
export function resolveFileReferencePath(input: string, directory: string) {
  if (!input || !directory || /[\u0000-\u001f]/.test(input)) return
  if (input.startsWith("~") || /^[A-Za-z]:(?![\\/])/.test(input)) return
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
