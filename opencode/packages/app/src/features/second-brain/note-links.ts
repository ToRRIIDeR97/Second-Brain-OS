import type { NoteSummary } from "./client"

export function normalizeWikiTarget(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/\.md$/i, "").replace(/\s+/g, "-").toLowerCase()
}

/** Lookup key for a wiki reference: only the note part, without a `#heading` or `#^block` suffix. */
export function wikiTargetKey(reference: string) {
  return normalizeWikiTarget(reference.replace(/[#^][\s\S]*$/, ""))
}

export function noteKeys(note: Pick<NoteSummary, "path" | "title">) {
  const path = normalizeWikiTarget(note.path)
  return new Set([normalizeWikiTarget(note.title), path, path.split("/").pop() ?? path])
}

/** Wiki reference key to note path. Build it once per note list, not once per keystroke. */
export function noteLinkLookup(notes: ReadonlyArray<Pick<NoteSummary, "path" | "title">>) {
  const lookup = new Map<string, string>()
  for (const note of notes) for (const key of noteKeys(note)) lookup.set(key, note.path)
  return lookup
}

// Turn existing wiki references into local links while leaving code and unresolved references alone.
export function previewNoteLinks(body: string, lookup: ReadonlyMap<string, string>) {
  return body.replace(
    /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`]*`+)|(?<!\\)\[\[([^\[\]\n]+)\]\]/g,
    (source, code, reference: string) => {
      if (code) return source
      const [target, alias] = reference.split("|", 2)
      const path = lookup.get(wikiTargetKey(target))
      if (!path) return source
      const label = (alias || target).replace(/[\\\[\]<>]/g, "\\$&")
      return `[${label}](/notes?note=${encodeURIComponent(path)})`
    },
  )
}
