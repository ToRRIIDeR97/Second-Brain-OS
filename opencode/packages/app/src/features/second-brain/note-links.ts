import type { NoteSummary } from "./client"

export function normalizeWikiTarget(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/\.md$/i, "").replace(/\s+/g, "-").toLowerCase()
}

export function noteKeys(note: Pick<NoteSummary, "path" | "title">) {
  const path = normalizeWikiTarget(note.path)
  return new Set([normalizeWikiTarget(note.title), path, path.split("/").pop() ?? path])
}

// Turn existing wiki references into local links while leaving code and unresolved references alone.
export function previewNoteLinks(body: string, notes: ReadonlyArray<Pick<NoteSummary, "path" | "title">>) {
  const lookup = new Map<string, string>()
  for (const note of notes) for (const key of noteKeys(note)) lookup.set(key, note.path)
  return body.replace(
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`]*`+)|(?<!\\)\[\[([^\[\]\n]+)\]\]/g,
    (source, code, reference: string) => {
      if (code) return source
      const [target, alias] = reference.split("|", 2)
      const path = lookup.get(normalizeWikiTarget(target))
      if (!path) return source
      const label = (alias || target).replace(/[\\\[\]<>]/g, "\\$&")
      return `[${label}](/notes?note=${encodeURIComponent(path)})`
    },
  )
}
