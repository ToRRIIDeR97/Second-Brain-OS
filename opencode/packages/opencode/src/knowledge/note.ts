export * as KnowledgeNote from "./note"

import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Frontmatter } from "@opencode-ai/core/frontmatter"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Effect, Option, Schema } from "effect"
import matter from "gray-matter"
import { createHash } from "node:crypto"
import { basename } from "node:path"

const directory = "notes"
const limit = 500
const maxBytes = 5 * 1024 * 1024
const titleLimit = 200
const tagLimit = 80
const projectPattern = /^project_[0-9A-Z]+$/i
// Keep a leading BOM in the text so decode() can detect it and the save path keeps it.
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true })

export const Info = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  projectIds: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  links: Schema.Array(Schema.String),
  updatedAt: Schema.String,
})
export type Info = typeof Info.Type

export const Document = Schema.Struct({
  info: Info,
  body: Schema.String,
  revision: Schema.String,
})
export type Document = typeof Document.Type

export const WriteInput = Schema.Struct({
  body: Schema.String,
  expectedRevision: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  projectIds: Schema.optional(Schema.Array(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  create: Schema.optional(Schema.Boolean),
})
export type WriteInput = typeof WriteInput.Type

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("KnowledgeNote.InvalidError", {
  reason: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("KnowledgeNote.NotFoundError", {
  path: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("KnowledgeNote.ConflictError", {
  reason: Schema.String,
}) {}

type Card = Document & {
  data: Record<string, unknown>
  source: string
  bom: boolean
}

export const list = Effect.fn("KnowledgeNote.list")(function* (search = "") {
  const fs = yield* FSUtil.Service
  const location = yield* Location.Service
  // Project notes live in the card folder: `.tenon/projects/<id>/notes`, or `projects/<id>/notes` before.
  const paths = yield* fs.glob(
    `{${directory}/**/*.md,.tenon/projects/project_*/notes/**/*.md,projects/project_*/notes/**/*.md}`,
    {
      cwd: location.directory,
      absolute: false,
      include: "file",
      dot: false,
    },
  )
  const query = search.trim().toLowerCase()
  // Check every candidate so search sees all notes; only notes changed since the last query are read.
  // One unreadable, oversized or malformed note is skipped so it cannot hide the rest.
  const notes = yield* Effect.forEach(
    paths.map((path) => path.replaceAll("\\", "/")).filter(isNotePath),
    (path) =>
      (query
        ? cachedSearchEntry(path).pipe(Effect.map((entry) => (entry.text.includes(query) ? entry.info : undefined)))
        : cachedSummary(path)
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Skipping unreadable note", { path, error: error._tag }).pipe(Effect.as(undefined)),
        ),
      ),
    { concurrency: 8 },
  )
  // Cap the result after filtering and sorting so the most recent matches are returned.
  return notes
    .filter((note): note is Info => note !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title))
    .slice(0, limit)
})

export const read = Effect.fn("KnowledgeNote.read")(function* (path: string) {
  const card = yield* readCard(yield* notePath(path))
  return { info: card.info, body: card.body, revision: card.revision }
})

export const write = Effect.fn("KnowledgeNote.write")(function* (path: string, input: WriteInput) {
  const normalizedPath = yield* notePath(path)
  if (Buffer.byteLength(input.body, "utf8") > maxBytes) return yield* new InvalidError({ reason: "too_large" })

  if (input.create) {
    const now = new Date().toISOString()
    const info = yield* Effect.try({
      try: () =>
        validate({
          path: normalizedPath,
          title: input.title?.trim() || titleFromBody(input.body) || basename(normalizedPath, ".md"),
          projectIds: normalizeProjects(input.projectIds ?? []),
          tags: normalizeTags(input.tags ?? []),
          links: extractLinks(input.body),
          updatedAt: now,
        }),
      catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_note" })),
    })
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const target = yield* mutation.resolve({ path: normalizedPath, kind: "file" })
    const source = encode(info, {}, input.body, false)
    yield* files
      .create({ target, content: source })
      .pipe(
        Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(new ConflictError({ reason: "exists" }))),
      )
    // Re-decode so the response matches what a later read returns (stringify normalizes the body).
    return decode(normalizedPath, source)
  }

  const card = yield* readCard(normalizedPath)
  if (input.expectedRevision !== undefined && input.expectedRevision !== card.revision) {
    return yield* new ConflictError({ reason: "stale" })
  }
  const info = yield* Effect.try({
    try: () =>
      validate({
        ...card.info,
        title: input.title?.trim() || card.info.title,
        projectIds: input.projectIds ? normalizeProjects(input.projectIds) : card.info.projectIds,
        tags: input.tags ? normalizeTags(input.tags) : card.info.tags,
        links: extractLinks(input.body),
        updatedAt: new Date().toISOString(),
      }),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_note" })),
  })
  const source = encode(info, card.data, input.body, card.bom)
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: normalizedPath, kind: "file" })
  yield* files
    .writeIfUnchanged({
      target,
      content: source,
      expected: card.bytes,
    })
    .pipe(Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))))
  // A save within the same millisecond and size would otherwise keep the old summary.
  summaries.delete(target.canonical)
  return decode(normalizedPath, source)
})

export const DeleteInput = Schema.Struct({
  expectedRevision: Schema.String,
})
export type DeleteInput = typeof DeleteInput.Type

/** Removes a note only while it still has the revision the caller last read. */
export const remove = Effect.fn("KnowledgeNote.remove")(function* (path: string, input: DeleteInput) {
  const normalizedPath = yield* notePath(path)
  const card = yield* readCard(normalizedPath)
  if (input.expectedRevision !== card.revision) return yield* new ConflictError({ reason: "stale" })
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: normalizedPath, kind: "file" })
  yield* files.remove({ target })
  summaries.delete(target.canonical)
  const searched = searchEntries.get(target.canonical)
  if (searched) {
    searchEntries.delete(target.canonical)
    searchTextSize -= searched.text.length
  }
  return card.info
})

const readCard = Effect.fn("KnowledgeNote.readCard")(function* (path: string) {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  yield* requireReadableSize(target.canonical, path)
  // Only a missing file is "not found"; permission and IO failures must surface, not read as empty.
  const bytes = yield* fs
    .readFile(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (bytes === undefined) return yield* new NotFoundError({ path })
  const card = yield* Effect.try({
    try: () => decode(path, utf8.decode(bytes)),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
  // The exact bytes read are the compare-and-swap baseline for a later save.
  return { ...card, bytes }
})

/** Refuse a note above the size cap before reading it, so one huge file cannot stall a list. */
const requireReadableSize = Effect.fnUntraced(function* (canonical: string, path: string) {
  const fs = yield* FSUtil.Service
  const stat = yield* fs
    .stat(canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (stat === undefined) return yield* new NotFoundError({ path })
  if (Number(stat.size) > maxBytes) return yield* new InvalidError({ reason: "too_large" })
  return stat
})

/**
 * Summaries for the unfiltered list, keyed by canonical path (so each workspace
 * has its own entries) and reused while the file's size and modification time
 * are unchanged. Bounded: the oldest entry is evicted first.
 */
const summaries = new Map<string, { mtime: number; size: number; info: Info }>()
const summaryLimit = 5_000

const cachedSummary = Effect.fnUntraced(function* (path: string) {
  const mutation = yield* LocationMutation.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  const stat = yield* requireReadableSize(target.canonical, path)
  const mtime = Option.match(stat.mtime, { onNone: () => -1, onSome: (date) => date.getTime() })
  const size = Number(stat.size)
  const cached = summaries.get(target.canonical)
  if (cached && mtime >= 0 && cached.mtime === mtime && cached.size === size) return cached.info
  const card = yield* readCard(path)
  summaries.delete(target.canonical)
  summaries.set(target.canonical, { mtime, size, info: card.info })
  const oldest = summaries.keys().next()
  if (summaries.size > summaryLimit && !oldest.done) summaries.delete(oldest.value)
  return card.info
})

// Searchable text per note, kept while its mtime and size are unchanged, so a query reads only notes that
// changed since the last one. Bounded by total characters; the least recently used notes are dropped first.
const searchEntries = new Map<string, { mtime: number; size: number; info: Info; text: string }>()
const searchTextLimit = 32 * 1024 * 1024
let searchTextSize = 0

const cachedSearchEntry = Effect.fnUntraced(function* (path: string) {
  const mutation = yield* LocationMutation.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  const stat = yield* requireReadableSize(target.canonical, path)
  const mtime = Option.match(stat.mtime, { onNone: () => -1, onSome: (date) => date.getTime() })
  const size = Number(stat.size)
  const cached = searchEntries.get(target.canonical)
  if (cached) {
    searchEntries.delete(target.canonical)
    searchTextSize -= cached.text.length
  }
  const entry =
    cached && mtime >= 0 && cached.mtime === mtime && cached.size === size
      ? cached
      : yield* readCard(path).pipe(
          Effect.map((card) => ({
            mtime,
            size,
            info: card.info,
            text: [card.body, card.info.title, card.info.path, ...card.info.tags, ...card.info.links]
              .join("\n")
              .toLowerCase(),
          })),
        )
  searchEntries.set(target.canonical, entry)
  searchTextSize += entry.text.length
  for (const [key, value] of searchEntries) {
    if (searchTextSize <= searchTextLimit || key === target.canonical) break
    searchEntries.delete(key)
    searchTextSize -= value.text.length
  }
  return entry
})

const notePath = Effect.fn("KnowledgeNote.notePath")(function* (input: string) {
  const path = input.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!isNotePath(path)) return yield* new InvalidError({ reason: "invalid_path" })
  return path
})

function isNotePath(path: string) {
  const global = path.startsWith(`${directory}/`)
  const managed = /^(?:\.tenon\/)?projects\/project_[0-9A-Z]+\/notes\/.+\.md$/i.test(path)
  return (global || managed) && path.toLowerCase().endsWith(".md") && !path.split("/").includes("..")
}

export function decode(path: string, raw: string): Card {
  const bom = raw.startsWith("\uFEFF")
  const source = bom ? raw.slice(1) : raw
  // Untrusted Markdown: never evaluates `---js` front matter and caps its size.
  const parsed = Frontmatter.parse(source)
  const data = { ...(parsed.data as Record<string, unknown>) }
  const projectIds = Array.isArray(data.project_ids)
    ? data.project_ids.filter((value): value is string => typeof value === "string" && projectPattern.test(value))
    : []
  // Reading is lenient so a hand-written note is never hidden; saving validates strictly.
  const info = {
    path,
    title: truncate(
      scalarText(data.title)?.trim() || titleFromBody(parsed.content) || basename(path, ".md"),
      titleLimit,
    ),
    projectIds: normalizeProjects(projectIds),
    tags: lenientTags(data.tags),
    links: extractLinks(parsed.content),
    updatedAt: dateString(data.updated_at),
  }
  return {
    info,
    body: parsed.content,
    revision: revision(raw),
    data,
    source: raw,
    bom,
  }
}

export function encode(info: Info, previous: Record<string, unknown>, body: string, bom = false) {
  const data = {
    ...previous,
    title: info.title,
    project_ids: [...info.projectIds],
    // Keep a hand-written `tags` value (a scalar, numbers, odd case) when the tags did not change.
    tags:
      previous.tags !== undefined && sameList(lenientTags(previous.tags), info.tags) ? previous.tags : [...info.tags],
    updated_at: info.updatedAt,
  }
  const source = matter.stringify(body, data, {})
  return bom ? `\uFEFF${source}` : source
}

function validate(info: Info) {
  if (!info.title || [...info.title].length > titleLimit) throw new InvalidError({ reason: "invalid_title" })
  if (
    info.projectIds.some((id) => !projectPattern.test(id)) ||
    new Set(info.projectIds).size !== info.projectIds.length
  ) {
    throw new InvalidError({ reason: "invalid_projects" })
  }
  const lowerTags = info.tags.map((tag) => tag.toLowerCase())
  if (info.tags.some((tag) => !tag || [...tag].length > tagLimit) || new Set(lowerTags).size !== lowerTags.length) {
    throw new InvalidError({ reason: "invalid_tags" })
  }
  if (info.links.length > 200 || info.links.some((link) => !link || [...link].length > 300)) {
    throw new InvalidError({ reason: "invalid_links" })
  }
  return info
}

function normalizeProjects(projectIds: ReadonlyArray<string>) {
  return [...new Set(projectIds.map((id) => id.trim()).filter(Boolean))]
}

function normalizeTags(tags: ReadonlyArray<string>) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

/**
 * Tags as a reader sees them: `tags: work, home`, `tags: [2024, q3]` and
 * `tags: [Work, work]` all decode. Over-long tags are dropped and case-insensitive
 * duplicates keep their first spelling.
 */
export function lenientTags(value: unknown) {
  const items: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  const seen = new Set<string>()
  return items
    .map((item) => scalarText(item)?.trim() ?? "")
    .filter((tag) => {
      if (!tag || [...tag].length > tagLimit || seen.has(tag.toLowerCase())) return false
      seen.add(tag.toLowerCase())
      return true
    })
}

function scalarText(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return String(value)
  return undefined
}

function truncate(value: string, limit: number) {
  const characters = [...value]
  return characters.length > limit ? characters.slice(0, limit).join("") : value
}

function sameList(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function extractLinks(body: string) {
  return [
    ...new Set(
      [...body.matchAll(/\[\[([^\]\n]{1,300})\]\]/g)]
        .map((match) => match[1]?.split("|", 1)[0]?.trim() ?? "")
        .filter(Boolean),
    ),
  ].slice(0, 200)
}

/**
 * The first `# Heading` line's text. The regex has no overlapping quantifiers, so it runs in linear
 * time; the closing `#` sequence is trimmed in code for the same reason.
 */
export function titleFromBody(body: string) {
  const heading = /^ {0,3}#[ \t]+(.*)$/m.exec(body)?.[1]
  if (!heading) return ""
  const text = heading.slice(0, 1000).trimEnd()
  let end = text.length
  while (end > 0 && text[end - 1] === "#") end--
  // A closing sequence counts only after a space, as in CommonMark: "# C#" keeps its "#".
  const closed = end === 0 || text[end - 1] === " " || text[end - 1] === "\t"
  return (closed ? text.slice(0, end) : text).trim()
}

function dateString(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return ""
}

function revision(source: string) {
  return createHash("sha256").update(source).digest("hex")
}
