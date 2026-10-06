export * as BrainProject from "./brain"

import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Effect, Option, Schema } from "effect"
import matter from "gray-matter"
import { ulid } from "ulid"
import type { PlannerCalendar } from "../planner/calendar"

const directory = "projects"
const limit = 1_000

export const Status = Schema.Literals(["active", "paused", "archived"])
export type Status = typeof Status.Type

export const ProjectLocation = Schema.Struct({
  workspaceId: Schema.String,
  displayPath: Schema.String,
})
export type ProjectLocation = typeof ProjectLocation.Type

export const Info = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  name: Schema.String,
  outcome: Schema.String,
  templateId: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.String,
  status: Status,
  progressPercent: Schema.Number,
  nextMilestone: Schema.optional(Schema.NullOr(Schema.String)),
  blocker: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.Array(Schema.String),
  location: Schema.optional(Schema.NullOr(ProjectLocation)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Info = typeof Info.Type

export const CreateInput = Schema.Struct({
  name: Schema.String,
  outcome: Schema.String,
  templateId: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  location: Schema.optional(Schema.NullOr(ProjectLocation)),
})
export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Schema.Struct({
  expectedUpdatedAt: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
  templateId: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  progressPercent: Schema.optional(Schema.Number),
  nextMilestone: Schema.optional(Schema.NullOr(Schema.String)),
  blocker: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  location: Schema.optional(Schema.NullOr(ProjectLocation)),
})
export type UpdateInput = typeof UpdateInput.Type

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("BrainProject.InvalidError", {
  reason: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("BrainProject.NotFoundError", {
  id: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("BrainProject.ConflictError", {
  reason: Schema.String,
}) {}

type Card = { info: Info; data: Record<string, unknown>; body: string; source: string }

export const list = Effect.fn("BrainProject.list")(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const paths = yield* fs.glob(`{${directory}/*.md,${directory}/*/project.md}`, {
    cwd: location.directory,
    absolute: false,
    include: "file",
    dot: false,
  })
  const projects = yield* Effect.forEach(paths.slice(0, limit), (path) => readCard(path.replaceAll("\\", "/")), {
    concurrency: 8,
  })
  return projects
    .map((card) => card.info)
    .sort(
      (left, right) =>
        statusRank(left.status) - statusRank(right.status) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.name.localeCompare(right.name),
    )
})

export const get = Effect.fn("BrainProject.get")(function* (id: string) {
  const path = yield* existingProjectPath(id)
  return (yield* readCard(path)).info
})

export const create = Effect.fn("BrainProject.create")(function* (input: CreateInput) {
  const projects = yield* list()
  const now = new Date().toISOString()
  const id = `project_${ulid()}`
  const info = yield* Effect.try({
    try: () =>
      validate({
        id,
        folder: managedFolder(id),
        name: input.name.trim(),
        outcome: input.outcome.trim(),
        templateId: optional(input.templateId),
        instructions: input.instructions?.trim() ?? "",
        status: "active",
        progressPercent: 0,
        nextMilestone: undefined,
        blocker: undefined,
        tags: normalizeTags(input.tags ?? []),
        location: normalizeLocation(input.location),
        createdAt: now,
        updatedAt: now,
      }),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
  if (projects.some((project) => project.name.toLowerCase() === info.name.toLowerCase())) {
    return yield* new ConflictError({ reason: "duplicate_name" })
  }
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: managedProjectPath(info.id), kind: "file" })
  yield* files
    .create({ target, content: encode(info, {}, `# ${info.name}\n\n${info.outcome}\n`) })
    .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(new ConflictError({ reason: "exists" }))))
  // The card exists now, so concurrent creates cannot duplicate it. Derived files
  // come after; if any of them fails, remove what this create wrote.
  yield* Effect.gen(function* () {
    const notesTarget = yield* mutation.resolve({ path: `${info.folder}/notes/.gitkeep`, kind: "file" })
    yield* files.write({ target: notesTarget, content: "" })
    const timelineTarget = yield* mutation.resolve({ path: `${info.folder}/timeline/calendar.json`, kind: "file" })
    yield* files.write({
      target: timelineTarget,
      content: timelineSource({ version: 2, revision: "", events: [], tasks: [] }),
    })
  }).pipe(
    Effect.onError(() =>
      Effect.gen(function* () {
        const card = yield* mutation.resolve({ path: managedProjectPath(info.id), kind: "file" })
        yield* files.remove({ target: card })
        const notes = yield* mutation.resolve({ path: `${info.folder}/notes/.gitkeep`, kind: "file" })
        yield* files.remove({ target: notes })
        const timeline = yield* mutation.resolve({ path: `${info.folder}/timeline/calendar.json`, kind: "file" })
        yield* files.remove({ target: timeline })
      }).pipe(Effect.ignore),
    ),
  )
  return info
})

export const update = Effect.fn("BrainProject.update")(function* (id: string, input: UpdateInput) {
  const path = yield* existingProjectPath(id)
  const card = yield* readCard(path)
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== card.info.updatedAt) {
    return yield* new ConflictError({ reason: "stale" })
  }
  const projects = yield* list()
  const info = yield* Effect.try({
    try: () =>
      validate({
        ...card.info,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome.trim() } : {}),
        ...(input.templateId !== undefined ? { templateId: optional(input.templateId) } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.progressPercent !== undefined ? { progressPercent: input.progressPercent } : {}),
        ...(input.nextMilestone !== undefined ? { nextMilestone: optional(input.nextMilestone) } : {}),
        ...(input.blocker !== undefined ? { blocker: optional(input.blocker) } : {}),
        ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
        ...(input.location !== undefined ? { location: normalizeLocation(input.location) } : {}),
        updatedAt: new Date().toISOString(),
      }),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
  if (
    projects.some(
      (project) => project.id !== id && project.name.trim().toLowerCase() === info.name.trim().toLowerCase(),
    )
  ) {
    return yield* new ConflictError({ reason: "duplicate_name" })
  }
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  yield* files
    .writeIfUnchanged({
      target,
      content: encode(info, card.data, card.body),
      expected: new TextEncoder().encode(card.source),
    })
    .pipe(Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))))
  return info
})

const existingProjectPath = Effect.fn("BrainProject.existingProjectPath")(function* (id: string) {
  if (!/^project_[0-9A-Z]+$/i.test(id)) return yield* new InvalidError({ reason: "invalid_id" })
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const managed = managedProjectPath(id)
  const managedTarget = yield* fs.resolve(`${location.directory}/${managed}`)
  if (yield* fs.existsSafe(managedTarget)) return managed
  return `${directory}/${id}.md`
})

export function managedFolder(id: string) {
  return `${directory}/${id}`
}

export function managedProjectPath(id: string) {
  return `${managedFolder(id)}/project.md`
}

export function projectTimeline(snapshot: PlannerCalendar.Snapshot, id: string): PlannerCalendar.Snapshot {
  return {
    ...snapshot,
    events: snapshot.events.filter((event) => event.projectId === id),
    tasks: snapshot.tasks.filter((task) => task.projectId === id),
  }
}

export const syncTimelines = Effect.fn("BrainProject.syncTimelines")(function* (snapshot: PlannerCalendar.Snapshot) {
  const projects = yield* list()
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  yield* Effect.forEach(
    projects,
    (project) =>
      Effect.gen(function* () {
        const target = yield* mutation.resolve({
          path: `${managedFolder(project.id)}/timeline/calendar.json`,
          kind: "file",
        })
        yield* files.write({ target, content: timelineSource(projectTimeline(snapshot, project.id)) })
      }),
    { concurrency: 8, discard: true },
  )
})

const readCard = Effect.fn("BrainProject.readCard")(function* (path: string) {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  const source = yield* fs.readFileStringSafe(target.canonical)
  if (source === undefined) return yield* new NotFoundError({ id: path.split("/").pop()?.replace(/\.md$/, "") ?? path })
  return yield* Effect.try({
    try: () => decode(source),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
})

export function decode(source: string): Card {
  const parsed = matter(source)
  const data = { ...(parsed.data as Record<string, unknown>) }
  const version = typeof data.version === "number" ? data.version : 1
  if (version > 2) throw new InvalidError({ reason: "unsupported_version" })
  const location =
    version === 1 && typeof data.workspace_id === "string" && typeof data.workspace_path === "string"
      ? { workspaceId: data.workspace_id, displayPath: data.workspace_path }
      : data.location
  const raw = {
    id: data.id,
    folder: typeof data.id === "string" ? managedFolder(data.id) : "",
    name: data.title,
    outcome: typeof data.outcome === "string" ? data.outcome : firstParagraph(parsed.content),
    templateId: data.template_id,
    instructions: typeof data.instructions === "string" ? data.instructions : "",
    status: data.status,
    progressPercent: typeof data.progress_percent === "number" ? data.progress_percent : 0,
    nextMilestone: data.next_milestone,
    blocker: data.blocker,
    tags: Array.isArray(data.tags) ? data.tags : [],
    location,
    createdAt: dateString(data.created_at ?? data.updated),
    updatedAt: dateString(data.updated_at ?? data.updated),
  }
  const decoded = Schema.decodeUnknownOption(Info)(raw)
  if (Option.isNone(decoded)) throw new InvalidError({ reason: "invalid_card" })
  const info = validate(decoded.value)
  return { info, data, body: parsed.content, source }
}

export function encode(info: Info, previous: Record<string, unknown>, body: string) {
  const data = { ...previous }
  delete data.workspace_id
  delete data.workspace_path
  delete data.updated
  Object.assign(data, {
    contract: "project_card",
    version: 2,
    id: info.id,
    type: "project",
    title: info.name,
    outcome: info.outcome,
    instructions: info.instructions,
    status: info.status,
    progress_percent: info.progressPercent,
    tags: [...info.tags],
    created_at: info.createdAt,
    updated_at: info.updatedAt,
  })
  setOptional(data, "template_id", info.templateId)
  setOptional(data, "next_milestone", info.nextMilestone)
  setOptional(data, "blocker", info.blocker)
  setOptional(data, "location", info.location)
  return matter.stringify(body, data)
}

function validate(info: Info) {
  if (!/^project_[0-9A-Z]+$/i.test(info.id) || info.folder !== managedFolder(info.id)) {
    throw new InvalidError({ reason: "invalid_id" })
  }
  if (info.name.length === 0 || [...info.name].length > 200) throw new InvalidError({ reason: "invalid_name" })
  if (info.outcome.length === 0 || [...info.outcome].length > 4_000)
    throw new InvalidError({ reason: "invalid_outcome" })
  if ([...info.instructions].length > 16_000) throw new InvalidError({ reason: "invalid_instructions" })
  if (!Number.isInteger(info.progressPercent) || info.progressPercent < 0 || info.progressPercent > 100)
    throw new InvalidError({ reason: "invalid_progress" })
  if ([info.nextMilestone, info.blocker].some((value) => value && [...value].length > 1_000))
    throw new InvalidError({ reason: "invalid_summary" })
  const tags = info.tags.map((tag) => tag.toLowerCase())
  if (info.tags.some((tag) => !tag || [...tag].length > 80) || new Set(tags).size !== tags.length)
    throw new InvalidError({ reason: "invalid_tags" })
  if (info.location && (!info.location.workspaceId.trim() || !info.location.displayPath.trim()))
    throw new InvalidError({ reason: "invalid_location" })
  return info
}

function timelineSource(snapshot: PlannerCalendar.Snapshot) {
  return JSON.stringify(snapshot, null, 2) + "\n"
}

function normalizeTags(tags: ReadonlyArray<string>) {
  return tags.map((tag) => tag.trim()).filter(Boolean)
}

function normalizeLocation(location: ProjectLocation | null | undefined) {
  if (!location) return undefined
  return { workspaceId: location.workspaceId.trim(), displayPath: location.displayPath.trim() }
}

function optional(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function setOptional(data: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined || value === null) {
    delete data[key]
    return
  }
  data[key] = value
}

function firstParagraph(body: string) {
  const lines = body.split(/\r?\n/).map((line) => line.trim())
  const start = lines.findIndex((line) => line && !line.startsWith("#"))
  if (start < 0) return ""
  const paragraph = lines.slice(start)
  const end = paragraph.findIndex((line) => !line || line.startsWith("#"))
  return paragraph.slice(0, end < 0 ? undefined : end).join(" ")
}

function dateString(value: unknown) {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return ""
}

function statusRank(status: Status) {
  if (status === "active") return 0
  if (status === "paused") return 1
  return 2
}
