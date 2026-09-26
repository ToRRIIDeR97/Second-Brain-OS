export * as KnowledgeNote from "./note"

import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Effect, Schema } from "effect"
import matter from "gray-matter"
import { createHash } from "node:crypto"
import { basename } from "node:path"

const directory = "notes"
const limit = 500
const maxBytes = 5 * 1024 * 1024
const projectPattern = /^project_[0-9A-Z]+$/i

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
  const paths = yield* fs.glob(`{${directory}/**/*.md,projects/*/notes/**/*.md}`, {
    cwd: location.directory,
    absolute: false,
    include: "file",
    dot: false,
  })
  const notes = yield* Effect.forEach(paths.slice(0, limit), (path) => readCard(path.replaceAll("\\", "/")), {
    concurrency: 8,
  })
  const query = search.trim().toLowerCase()
  return notes
    .filter(
      (note) =>
        !query ||
        [note.body, note.info.title, note.info.path, ...note.info.tags, ...note.info.links].some((value) =>
          value.toLowerCase().includes(query),
        ),
    )
    .map((note) => note.info)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title))
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
    const info = validate({
      path: normalizedPath,
      title: input.title?.trim() || titleFromBody(input.body) || basename(normalizedPath, ".md"),
      projectIds: normalizeProjects(input.projectIds ?? []),
      tags: normalizeTags(input.tags ?? []),
      links: extractLinks(input.body),
      updatedAt: now,
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
    return decode(normalizedPath, source)
  }

  const card = yield* readCard(normalizedPath)
  if (input.expectedRevision !== undefined && input.expectedRevision !== card.revision) {
    return yield* new ConflictError({ reason: "stale" })
  }
  const info = validate({
    ...card.info,
    title: input.title?.trim() || card.info.title,
    projectIds: input.projectIds ? normalizeProjects(input.projectIds) : card.info.projectIds,
    tags: input.tags ? normalizeTags(input.tags) : card.info.tags,
    links: extractLinks(input.body),
    updatedAt: new Date().toISOString(),
  })
  const source = encode(info, card.data, input.body, card.bom)
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: normalizedPath, kind: "file" })
  yield* files
    .writeIfUnchanged({
      target,
      content: source,
      expected: new TextEncoder().encode(card.source),
    })
    .pipe(Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))))
  return decode(normalizedPath, source)
})

const readCard = Effect.fn("KnowledgeNote.readCard")(function* (path: string) {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  const source = yield* fs.readFileStringSafe(target.canonical)
  if (source === undefined) return yield* new NotFoundError({ path })
  return decode(path, source)
})

const notePath = Effect.fn("KnowledgeNote.notePath")(function* (input: string) {
  const path = input.replaceAll("\\", "/").replace(/^\.\//, "")
  const global = path.startsWith(`${directory}/`)
  const managed = /^projects\/project_[0-9A-Z]+\/notes\/.+\.md$/i.test(path)
  if ((!global && !managed) || !path.toLowerCase().endsWith(".md") || path.split("/").includes("..")) {
    return yield* new InvalidError({ reason: "invalid_path" })
  }
  return path
})

export function decode(path: string, raw: string): Card {
  const bom = raw.startsWith("\uFEFF")
  const source = bom ? raw.slice(1) : raw
  const parsed = matter(source)
  const data = { ...(parsed.data as Record<string, unknown>) }
  const projectIds = Array.isArray(data.project_ids)
    ? data.project_ids.filter((value): value is string => typeof value === "string" && projectPattern.test(value))
    : []
  const tags = Array.isArray(data.tags) ? data.tags.filter((value): value is string => typeof value === "string") : []
  const info = validate({
    path,
    title:
      (typeof data.title === "string" && data.title.trim()) || titleFromBody(parsed.content) || basename(path, ".md"),
    projectIds: normalizeProjects(projectIds),
    tags: normalizeTags(tags),
    links: extractLinks(parsed.content),
    updatedAt: dateString(data.updated_at),
  })
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
    tags: [...info.tags],
    updated_at: info.updatedAt,
  }
  const source = matter.stringify(body, data)
  return bom ? `\uFEFF${source}` : source
}

function validate(info: Info) {
  if (!info.title || [...info.title].length > 200) throw new InvalidError({ reason: "invalid_title" })
  if (
    info.projectIds.some((id) => !projectPattern.test(id)) ||
    new Set(info.projectIds).size !== info.projectIds.length
  ) {
    throw new InvalidError({ reason: "invalid_projects" })
  }
  const lowerTags = info.tags.map((tag) => tag.toLowerCase())
  if (info.tags.some((tag) => !tag || [...tag].length > 80) || new Set(lowerTags).size !== lowerTags.length) {
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

export function extractLinks(body: string) {
  return [
    ...new Set(
      [...body.matchAll(/\[\[([^\]\n]{1,300})\]\]/g)]
        .map((match) => match[1]?.split("|", 1)[0]?.trim() ?? "")
        .filter(Boolean),
    ),
  ].slice(0, 200)
}

function titleFromBody(body: string) {
  return body.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() ?? ""
}

function dateString(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return ""
}

function revision(source: string) {
  return createHash("sha256").update(source).digest("hex")
}
