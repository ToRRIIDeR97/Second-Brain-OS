export * as BrainProject from "./brain"

import { Database } from "@opencode-ai/core/database/database"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { and, count, inArray, isNull, max } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import matter from "gray-matter"
import path from "node:path"
import { ulid } from "ulid"
import type { PlannerCalendar } from "../planner/calendar"

const directory = "projects"
const limit = 1_000
const idPattern = /^project_[0-9A-Z]+$/i
const utf8 = new TextDecoder()

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

/** An OpenCode project (folder or repository), shown as a Workspace in the UI. */
export const Workspace = Schema.Struct({
  id: Schema.String,
  worktree: Schema.String,
  name: Schema.optional(Schema.String),
})
export type Workspace = typeof Workspace.Type

export const ThreadDirectoryKind = Schema.Literals(["workspace", "folder"])
export type ThreadDirectoryKind = typeof ThreadDirectoryKind.Type

export const ThreadSummary = Schema.Struct({
  project: Info,
  /** Absolute directory where this Project's threads run; pass it verbatim as the session directory. */
  threadDirectory: Schema.String,
  threadDirectoryKind: ThreadDirectoryKind,
  /** The linked Workspace when it is known to the server; null for unlinked or missing Workspaces. */
  workspace: Schema.NullOr(Workspace),
  rootSessionCount: Schema.Number,
  /** Epoch milliseconds of the most recently updated root thread, or null when there are none. */
  lastActivityAt: Schema.NullOr(Schema.Number),
})
export type ThreadSummary = typeof ThreadSummary.Type

export const EnsureWorkspaceInput = Schema.Struct({
  workspaceId: Schema.String,
})
export type EnsureWorkspaceInput = typeof EnsureWorkspaceInput.Type

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("BrainProject.InvalidError", {
  reason: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("BrainProject.NotFoundError", {
  id: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("BrainProject.ConflictError", {
  reason: Schema.String,
}) {}

type Card = { info: Info; data: Record<string, unknown>; body: string }

export const list = Effect.fn("BrainProject.list")(function* () {
  return (yield* all()).slice(0, limit)
})

/**
 * Every readable Project card, sorted. One card per id: the managed
 * `projects/<id>/project.md` wins over a legacy flat `projects/<id>.md`, and a
 * card whose id does not match its path is ignored. Unreadable cards are
 * skipped with a warning so one bad file cannot hide the rest.
 */
const all = Effect.fn("BrainProject.all")(function* () {
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const paths = yield* fs.glob(`{${directory}/project_*.md,${directory}/project_*/project.md}`, {
    cwd: location.directory,
    absolute: false,
    include: "file",
    dot: false,
  })
  const cards = yield* Effect.forEach(
    paths.map((path) => path.replaceAll("\\", "/")),
    (path) =>
      readCard(path).pipe(
        Effect.flatMap((card) =>
          card.info.id === pathId(path)
            ? Effect.succeed({ path, info: card.info })
            : Effect.logWarning("Skipping Project card whose id does not match its path", { path }).pipe(
                Effect.as(undefined),
              ),
        ),
        Effect.catch((error) =>
          Effect.logWarning("Skipping unreadable Project card", { path, error: error._tag }).pipe(Effect.as(undefined)),
        ),
      ),
    { concurrency: 8 },
  )
  const byId = new Map<string, Info>()
  cards
    .filter((card) => card !== undefined)
    // Managed cards sort last so they replace a legacy flat card with the same id.
    .sort((left, right) => Number(left.path.endsWith("/project.md")) - Number(right.path.endsWith("/project.md")))
    .forEach((card) => byId.set(card.info.id, card.info))
  return [...byId.values()].sort(
    (left, right) =>
      statusRank(left.status) - statusRank(right.status) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.name.localeCompare(right.name),
  )
})

/** The id a card path names: `projects/<id>.md` or `projects/<id>/project.md`. */
function pathId(path: string) {
  const parts = path.split("/")
  return parts.length === 3 ? parts[1] : parts[1]?.replace(/\.md$/, "")
}

export const get = Effect.fn("BrainProject.get")(function* (id: string) {
  return (yield* readProjectCard(id)).info
})

/** `projects` is the caller's already-loaded full list, used for the duplicate-name check. */
export const create = Effect.fn("BrainProject.create")(function* (input: CreateInput, projects?: ReadonlyArray<Info>) {
  const existing = projects ?? (yield* all())
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
  if (existing.some((project) => project.name.toLowerCase() === info.name.toLowerCase())) {
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
  const card = yield* readProjectCard(id)
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== card.info.updatedAt) {
    return yield* new ConflictError({ reason: "stale" })
  }
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
  // Only a rename can introduce a duplicate name, so only then list the other cards.
  if (
    input.name !== undefined &&
    (yield* all()).some(
      (project) => project.id !== id && project.name.trim().toLowerCase() === info.name.trim().toLowerCase(),
    )
  ) {
    return yield* new ConflictError({ reason: "duplicate_name" })
  }
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const target = yield* mutation.resolve({ path: card.path, kind: "file" })
  yield* files
    .writeIfUnchanged({
      target,
      content: encode(info, card.data, card.body),
      expected: card.bytes,
    })
    .pipe(Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(new ConflictError({ reason: "stale" }))))
  return info
})

/**
 * Return the Project linked to `workspace`, creating one when none links to it.
 * Idempotent: a second call returns the same Project. Only writes Markdown cards
 * and the Project folder; never moves files.
 */
export const ensureForWorkspace = Effect.fn("BrainProject.ensureForWorkspace")(function* (
  workspace: Workspace,
  loaded?: ReadonlyArray<Info>,
) {
  const projects = loaded ?? (yield* all())
  const existing = projects.find((project) => project.location?.workspaceId === workspace.id)
  if (existing) return { project: existing, created: false }
  const base = workspaceName(workspace)
  const project = yield* create(
    {
      name: uniqueName(base, new Set(projects.map((project) => project.name.trim().toLowerCase()))),
      outcome: `Threads and work in ${base}.`,
      location: { workspaceId: workspace.id, displayPath: workspace.worktree },
    },
    projects,
  )
  return { project, created: true }
})

/**
 * Resolve where a Project's threads run: the linked Workspace worktree when it is
 * known, otherwise the Project folder inside the Brain directory (created when a
 * legacy flat card has none yet).
 */
export const threadDirectory = Effect.fn("BrainProject.threadDirectory")(function* (
  project: Info,
  workspaces: ReadonlyArray<Workspace> = [],
) {
  const workspace = project.location
    ? workspaces.find((candidate) => candidate.id === project.location?.workspaceId)
    : undefined
  if (workspace) return { kind: "workspace" as const, directory: workspace.worktree, workspace }
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const directory = path.join(location.directory, project.folder)
  if (!(yield* fs.existsSafe(directory))) {
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const target = yield* mutation.resolve({ path: `${project.folder}/notes/.gitkeep`, kind: "file" })
    yield* files.write({ target, content: "" })
  }
  return { kind: "folder" as const, directory, workspace: undefined }
})

/** Root (non-archived, non-child) thread counts and last activity keyed by session directory. */
export const threadStats = Effect.fn("BrainProject.threadStats")(function* (directories: ReadonlyArray<string>) {
  if (directories.length === 0) return new Map<string, { count: number; lastActivityAt: number | null }>()
  const database = yield* Database.Service
  const db = database.db
  const rows = yield* db
    .select({ directory: SessionTable.directory, count: count(), last: max(SessionTable.time_updated) })
    .from(SessionTable)
    .where(
      and(
        inArray(SessionTable.directory, [...new Set(directories)]),
        isNull(SessionTable.parent_id),
        isNull(SessionTable.time_archived),
      ),
    )
    .groupBy(SessionTable.directory)
    .all()
    .pipe(Effect.orDie)
  return new Map(rows.map((row) => [row.directory, { count: row.count, lastActivityAt: row.last ?? null }]))
})

/** OpenCode project ids that own at least one root thread. */
export const workspaceIdsWithThreads = Effect.fn("BrainProject.workspaceIdsWithThreads")(function* () {
  const database = yield* Database.Service
  const rows = yield* database.db
    .selectDistinct({ id: SessionTable.project_id })
    .from(SessionTable)
    .where(isNull(SessionTable.parent_id))
    .all()
    .pipe(Effect.orDie)
  return new Set(rows.map((row) => String(row.id)))
})

/**
 * Workspaces the migration should give a Project: they have threads, are real
 * folders (not the shared `global` project), and are not the Brain itself.
 */
export function migrationCandidates(input: {
  workspaces: ReadonlyArray<Workspace>
  withThreads: ReadonlySet<string>
  brainDirectory: string
}) {
  const brain = path.resolve(input.brainDirectory)
  return input.workspaces.filter(
    (workspace) =>
      workspace.id !== "global" && input.withThreads.has(workspace.id) && path.resolve(workspace.worktree) !== brain,
  )
}

/** Create Projects for Workspaces no Project links to. Idempotent; returns counts only. */
export const migrateWorkspaces = Effect.fn("BrainProject.migrateWorkspaces")(function* (
  workspaces: ReadonlyArray<Workspace>,
) {
  // Sequential so generated names stay unique across this pass; one failure does not stop the rest.
  // The card list is read once and extended with each created Project.
  const projects = [...(yield* all())]
  const results = yield* Effect.forEach(workspaces, (workspace) =>
    ensureForWorkspace(workspace, projects).pipe(
      Effect.tap((result) => Effect.sync(() => result.created && projects.push(result.project))),
      Effect.option,
    ),
  )
  const done = results.filter(Option.isSome).map((result) => result.value)
  return {
    created: done.filter((result) => result.created).length,
    linked: done.filter((result) => !result.created).length,
    failed: results.length - done.length,
  }
})

function workspaceName(workspace: Workspace) {
  const name = path.basename(workspace.worktree.replace(/[\\/]+$/, "")) || workspace.id
  return [...name].slice(0, 180).join("")
}

function uniqueName(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base.toLowerCase())) return base
  for (let index = 2; ; index++) {
    const candidate = `${base} (${index})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

const existingProjectPath = Effect.fn("BrainProject.existingProjectPath")(function* (id: string) {
  if (!idPattern.test(id)) return yield* new InvalidError({ reason: "invalid_id" })
  const location = yield* Location.Service
  const fs = yield* FSUtil.Service
  const managed = managedProjectPath(id)
  const managedTarget = yield* fs.resolve(`${location.directory}/${managed}`)
  if (yield* fs.existsSafe(managedTarget)) return managed
  return `${directory}/${id}.md`
})

const readProjectCard = Effect.fn("BrainProject.readProjectCard")(function* (id: string) {
  const path = yield* existingProjectPath(id)
  const card = yield* readCard(path)
  // A card whose id does not match its path is not this Project; the list ignores it too.
  if (card.info.id !== pathId(path)) return yield* new NotFoundError({ id })
  return { ...card, path }
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

/**
 * Mirror each Project's slice of the calendar into `projects/<id>/timeline/calendar.json`.
 * Only files whose events or tasks changed are rewritten; the calendar revision
 * alone changes on every save, so it does not count as a change.
 */
export const syncTimelines = Effect.fn("BrainProject.syncTimelines")(function* (snapshot: PlannerCalendar.Snapshot) {
  const projects = yield* all()
  const mutation = yield* LocationMutation.Service
  const files = yield* FileMutation.Service
  const fs = yield* FSUtil.Service
  yield* Effect.forEach(
    projects,
    (project) =>
      Effect.gen(function* () {
        const target = yield* mutation.resolve({
          path: `${managedFolder(project.id)}/timeline/calendar.json`,
          kind: "file",
        })
        const next = projectTimeline(snapshot, project.id)
        const current = yield* fs.readFileString(target.canonical).pipe(Effect.option)
        if (Option.isSome(current) && sameTimeline(current.value, next)) return
        yield* files.write({ target, content: timelineSource(next) })
      }),
    { concurrency: 8, discard: true },
  )
})

const readCard = Effect.fn("BrainProject.readCard")(function* (path: string) {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path, kind: "file" })
  // Only a missing file is "not found"; permission and IO failures must surface.
  const bytes = yield* fs
    .readFile(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (bytes === undefined) return yield* new NotFoundError({ id: pathId(path) ?? path })
  const card = yield* Effect.try({
    try: () => decode(utf8.decode(bytes)),
    catch: (error) => (error instanceof InvalidError ? error : new InvalidError({ reason: "invalid_card" })),
  })
  // The exact bytes read are the compare-and-swap baseline for a later save.
  return { ...card, bytes }
})

export function decode(source: string): Card {
  // Passing options disables gray-matter's unbounded module-level parse cache.
  const parsed = matter(source, {})
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
  return { info, data, body: parsed.content }
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
  return matter.stringify(body, data, {})
}

function validate(info: Info) {
  if (!idPattern.test(info.id) || info.folder !== managedFolder(info.id)) {
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

function sameTimeline(source: string, next: PlannerCalendar.Snapshot) {
  const current = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ revision: Schema.String })))(source)
  return Option.isSome(current) && source === timelineSource({ ...next, revision: current.value.revision })
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
