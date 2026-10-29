import { InstanceState } from "@/effect/instance-state"
import { KnowledgeNote } from "@/knowledge/note"
import { PlannerCalendar } from "@/planner/calendar"
import { BrainProject } from "@/project/brain"
import { Project } from "@/project/project"
import { Database } from "@opencode-ai/core/database/database"
import { KeyedMutex } from "@opencode-ai/core/effect/keyed-mutex"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect, Layer } from "effect"
import { PlatformError } from "effect/PlatformError"
import { rmdir } from "node:fs/promises"
import path from "node:path"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { SecondBrainConflictError, SecondBrainInvalidError } from "../groups/second-brain"

const CALENDAR_PATH = ".tenon/calendar-v1.json"
// Where earlier builds kept the calendar; the first read moves it into `.tenon`.
const LEGACY_CALENDAR_PATH = ".second-brain/calendar-v1.json"
const CALENDAR_LIMIT = 16 * 1024 * 1024

type ApiFailure =
  | SecondBrainInvalidError
  | HttpApiError.NotFound
  | SecondBrainConflictError
  | HttpApiError.InternalServerError

export const secondBrainHandlers = HttpApiBuilder.group(InstanceHttpApi, "secondBrain", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const opencodeProjects = yield* Project.Service
    const database = yield* Database.Service
    // One lock per Brain directory serializes calendar saves (with their timeline sync),
    // Project mutations and project folder scans, so none of them interleave.
    const brainLocks = KeyedMutex.makeUnsafe<string>()
    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })
    const serialized = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* brainLocks.withLock((yield* InstanceState.context).directory)(effect)
    })

    const listNotes = Effect.fn("SecondBrain.listNotes")(function* (ctx: { query: { search?: string } }) {
      return yield* filesystem(KnowledgeNote.list(ctx.query.search)).pipe(failure("listNotes"))
    })

    const readNote = Effect.fn("SecondBrain.readNote")(function* (ctx: { query: { path: string } }) {
      return yield* filesystem(KnowledgeNote.read(ctx.query.path)).pipe(failure("readNote", ctx.query.path))
    })

    const writeNote = Effect.fn("SecondBrain.writeNote")(function* (ctx: {
      query: { path: string }
      payload: KnowledgeNote.WriteInput
    }) {
      return yield* filesystem(KnowledgeNote.write(ctx.query.path, ctx.payload)).pipe(
        failure("writeNote", ctx.query.path),
      )
    })

    const readCalendar = Effect.fn("SecondBrain.readCalendar")(function* () {
      return yield* filesystem(calendarFile().pipe(Effect.flatMap((file) => decodeCalendar(file.bytes)))).pipe(
        failure("readCalendar", CALENDAR_PATH),
      )
    })

    const writeCalendar = Effect.fn("SecondBrain.writeCalendar")(function* (ctx: {
      payload: PlannerCalendar.WriteInput
    }) {
      return yield* serialized(filesystem(saveCalendar(ctx.payload))).pipe(failure("writeCalendar", CALENDAR_PATH))
    })

    const listProjects = Effect.fn("SecondBrain.listProjects")(function* () {
      return yield* filesystem(BrainProject.list()).pipe(failure("listProjects"))
    })

    // A new Project has no calendar items yet, so creating one does not re-sync timelines.
    const createProject = Effect.fn("SecondBrain.createProject")(function* (ctx: {
      payload: BrainProject.CreateInput
    }) {
      return yield* serialized(filesystem(BrainProject.create(ctx.payload))).pipe(failure("createProject"))
    })

    const workspaces = Effect.fn("SecondBrain.workspaces")(function* () {
      return (yield* opencodeProjects.list()).map(
        (project): BrainProject.Workspace => ({
          id: project.id,
          worktree: project.worktree,
          ...(project.name ? { name: project.name } : {}),
        }),
      )
    })

    const listProjectThreads = Effect.fn("SecondBrain.listProjectThreads")(function* () {
      const known = yield* workspaces()
      return yield* filesystem(
        Effect.gen(function* () {
          const projects = yield* BrainProject.list()
          const linked = yield* BrainProject.linkedFolders().pipe(Effect.provideService(Global.Service, Global.make()))
          const resolved = yield* Effect.forEach(
            projects,
            (project) =>
              BrainProject.threadDirectory(project, known, linked).pipe(Effect.map((thread) => ({ project, thread }))),
            { concurrency: 8 },
          )
          const stats = yield* BrainProject.threadStats(resolved.map((item) => item.thread.directory)).pipe(
            Effect.provideService(Database.Service, database),
          )
          return resolved.map(({ project, thread }): BrainProject.ThreadSummary => {
            const stat = stats.get(thread.directory)
            return {
              project,
              threadDirectory: thread.directory,
              threadDirectoryKind: thread.kind,
              workspace: thread.workspace ?? null,
              rootSessionCount: stat?.count ?? 0,
              lastActivityAt: stat?.lastActivityAt ?? null,
            }
          })
        }),
      ).pipe(failure("listProjectThreads"))
    })

    const ensureWorkspaceProject = Effect.fn("SecondBrain.ensureWorkspaceProject")(function* (ctx: {
      payload: BrainProject.EnsureWorkspaceInput
    }) {
      const id = ctx.payload.workspaceId.trim()
      if (!id || id === "global") return yield* invalid("invalid_workspace")
      const workspace = yield* opencodeProjects.get(ProjectV2.ID.make(id))
      if (!workspace) return yield* new HttpApiError.NotFound({})
      const brainDirectory = (yield* InstanceState.context).directory
      if (path.resolve(workspace.worktree) === path.resolve(brainDirectory)) return yield* invalid("invalid_workspace")
      const result = yield* serialized(
        filesystem(BrainProject.ensureForWorkspace({ id: workspace.id, worktree: workspace.worktree })),
      ).pipe(failure("ensureWorkspaceProject"))
      return result.project
    })

    const scanProjects = Effect.fn("SecondBrain.scanProjects")(function* () {
      return yield* serialized(
        filesystem(BrainProject.scan().pipe(Effect.provideService(Global.Service, Global.make()))),
      ).pipe(failure("scanProjects"))
    })

    const linkProjectFolder = Effect.fn("SecondBrain.linkProjectFolder")(function* (ctx: {
      payload: BrainProject.LinkInput
    }) {
      return yield* serialized(
        filesystem(BrainProject.link(ctx.payload).pipe(Effect.provideService(Global.Service, Global.make()))),
      ).pipe(failure("linkProjectFolder"))
    })

    const unlinkProjectFolder = Effect.fn("SecondBrain.unlinkProjectFolder")(function* (ctx: {
      payload: BrainProject.LinkInput
    }) {
      return yield* serialized(
        filesystem(BrainProject.unlink(ctx.payload).pipe(Effect.provideService(Global.Service, Global.make()))),
      ).pipe(failure("unlinkProjectFolder"))
    })

    const readInstructions = Effect.fn("SecondBrain.readInstructions")(function* () {
      return yield* filesystem(BrainProject.readInstructions()).pipe(failure("readInstructions", "AGENTS.md"))
    })

    const writeInstructions = Effect.fn("SecondBrain.writeInstructions")(function* (ctx: {
      payload: BrainProject.InstructionsInput
    }) {
      return yield* filesystem(BrainProject.writeInstructions(ctx.payload)).pipe(
        failure("writeInstructions", "AGENTS.md"),
      )
    })

    const removeInstructions = Effect.fn("SecondBrain.removeInstructions")(function* () {
      return yield* filesystem(BrainProject.removeInstructions()).pipe(failure("removeInstructions", "AGENTS.md"))
    })

    const readProject = Effect.fn("SecondBrain.readProject")(function* (ctx: { query: { id: string } }) {
      return yield* filesystem(BrainProject.get(ctx.query.id)).pipe(failure("readProject", ctx.query.id))
    })

    const updateProject = Effect.fn("SecondBrain.updateProject")(function* (ctx: {
      query: { id: string }
      payload: BrainProject.UpdateInput
    }) {
      return yield* serialized(filesystem(BrainProject.update(ctx.query.id, ctx.payload))).pipe(
        failure("updateProject", ctx.query.id),
      )
    })

    return handlers
      .handle("listNotes", listNotes)
      .handle("readNote", readNote)
      .handle("writeNote", writeNote)
      .handle("readCalendar", readCalendar)
      .handle("writeCalendar", writeCalendar)
      .handle("listProjects", listProjects)
      .handle("createProject", createProject)
      .handle("listProjectThreads", listProjectThreads)
      .handle("ensureWorkspaceProject", ensureWorkspaceProject)
      .handle("scanProjects", scanProjects)
      .handle("linkProjectFolder", linkProjectFolder)
      .handle("unlinkProjectFolder", unlinkProjectFolder)
      .handle("readInstructions", readInstructions)
      .handle("writeInstructions", writeInstructions)
      .handle("removeInstructions", removeInstructions)
      .handle("readProject", readProject)
      .handle("updateProject", updateProject)
  }),
).pipe(Layer.provide(locationServiceMapLayer))

/** Read the calendar bytes; only a missing file reads as absent, so permission errors are not an empty calendar. */
const calendarFile = Effect.fn("SecondBrain.calendarFile")(function* () {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const target = yield* mutation.resolve({ path: CALENDAR_PATH, kind: "file" })
  yield* migrateCalendar(target)
  // Refuse an oversized calendar before reading it; "too_large" is not moved aside by a save.
  const stat = yield* fs
    .stat(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (stat && Number(stat.size) > CALENDAR_LIMIT)
    return yield* new PlannerCalendar.InvalidError({ reason: "too_large" })
  const bytes = yield* fs
    .readFile(target.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  return { target, bytes }
})

/**
 * Move a calendar from `.second-brain` into `.tenon` when only the old file exists: write the new file,
 * then remove the old one and its folder if that is now empty. With both present the new one wins and
 * the old one is left alone. The bytes move as they are, so a damaged file is still moved aside on save.
 */
const migrateCalendar = Effect.fn("SecondBrain.migrateCalendar")(function* (target: LocationMutation.Target) {
  const mutation = yield* LocationMutation.Service
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  if (yield* fs.existsSafe(target.canonical)) return
  const legacy = yield* mutation.resolve({ path: LEGACY_CALENDAR_PATH, kind: "file" })
  const bytes = yield* fs
    .readFile(legacy.canonical)
    .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
  if (!bytes) return
  // A concurrent read may have moved it first; its copy holds the same bytes.
  yield* files
    .create({ target, content: bytes })
    .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.void))
  yield* files.remove({ target: legacy })
  // rmdir removes the folder only when it is empty; anything else left there keeps it.
  yield* Effect.tryPromise(() => rmdir(path.dirname(legacy.canonical))).pipe(Effect.ignore)
  yield* Effect.logInfo("Moved the Second Brain calendar into .tenon")
})

const decodeCalendar = (bytes: Uint8Array | undefined) =>
  Effect.try({
    // The default decoder drops a leading BOM, which JSON.parse would reject.
    try: () => PlannerCalendar.decode(bytes && new TextDecoder().decode(bytes)),
    catch: (error) =>
      error instanceof PlannerCalendar.InvalidError
        ? error
        : new PlannerCalendar.InvalidError({ reason: "invalid_document" }),
  })

/**
 * Compare-and-swap the whole calendar, then mirror it into Project timelines.
 * An undecodable calendar file is moved aside to `calendar-v1.json.corrupt-<time>`
 * and replaced, so a damaged file cannot block every later save.
 */
const saveCalendar = Effect.fn("SecondBrain.saveCalendar")(function* (input: PlannerCalendar.WriteInput) {
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  const file = yield* calendarFile()
  // Validate the new calendar before touching a damaged file.
  const next = yield* Effect.try({
    try: () => PlannerCalendar.encode(input.events, input.tasks),
    catch: (error) =>
      error instanceof PlannerCalendar.InvalidError
        ? error
        : new PlannerCalendar.InvalidError({ reason: "invalid_document" }),
  })
  const current = yield* decodeCalendar(file.bytes).pipe(
    Effect.catchIf(
      // Only a file that is not a calendar document at all is moved aside; a document
      // that parses but fails validation (for example too_many_events) still fails the save.
      (error) => error.reason === "invalid_json" || error.reason === "invalid_document",
      (error) =>
        Effect.gen(function* () {
          yield* fs.rename(file.target.canonical, `${file.target.canonical}.corrupt-${Date.now()}`)
          yield* Effect.logWarning("Moved an undecodable Second Brain calendar aside", {
            path: CALENDAR_PATH,
            reason: error.reason,
          })
          return undefined
        }),
    ),
  )
  if (current && input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return yield* conflict("stale")
  }
  yield* current === undefined || file.bytes === undefined
    ? files
        .create({ target: file.target, content: next.source })
        .pipe(Effect.catchTag("FileMutation.TargetExistsError", () => Effect.fail(conflict("stale"))))
    : files
        .writeIfUnchanged({ target: file.target, content: next.source, expected: file.bytes })
        .pipe(Effect.catchTag("FileMutation.StaleContentError", () => Effect.fail(conflict("stale"))))
  const snapshot = { version: next.version, revision: next.revision, events: next.events, tasks: next.tasks }
  yield* BrainProject.syncTimelines(snapshot, current).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Second Brain project timeline sync failed; project timelines may be stale", {
        error: error._tag,
      }),
    ),
  )
  return snapshot
})

/**
 * Translate every Second Brain failure at one boundary: domain validation is a 400
 * carrying its reason, a missing record 404, a stale write 409, and anything else
 * (IO, permissions) a logged 500. Logs carry the error tag, reason and the
 * request's relative path or id, never file content.
 */
function failure(operation: string, path?: string) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ApiFailure, R> =>
    effect.pipe(Effect.catch((error) => toApiFailure(operation, path, error)))
}

function toApiFailure(operation: string, path: string | undefined, error: unknown): Effect.Effect<never, ApiFailure> {
  if (
    error instanceof SecondBrainInvalidError ||
    error instanceof HttpApiError.NotFound ||
    error instanceof SecondBrainConflictError ||
    error instanceof HttpApiError.InternalServerError
  ) {
    return Effect.fail(error)
  }
  if (error instanceof KnowledgeNote.NotFoundError || error instanceof BrainProject.NotFoundError) {
    return Effect.fail(new HttpApiError.NotFound({}))
  }
  if (error instanceof KnowledgeNote.ConflictError || error instanceof BrainProject.ConflictError) {
    return Effect.fail(conflict(error.reason))
  }
  if (
    error instanceof KnowledgeNote.InvalidError ||
    error instanceof BrainProject.InvalidError ||
    error instanceof PlannerCalendar.InvalidError ||
    error instanceof LocationMutation.PathError
  ) {
    return Effect.logWarning("Second Brain request rejected", {
      operation,
      path,
      error: error._tag,
      reason: error.reason,
    }).pipe(Effect.andThen(Effect.fail(invalid(error.reason))))
  }
  return Effect.logError("Second Brain request failed", {
    operation,
    path,
    error: error instanceof PlatformError || error instanceof FSUtil.FileSystemError ? error._tag : "Unknown",
    reason:
      error instanceof PlatformError
        ? error.reason._tag
        : error instanceof FSUtil.FileSystemError
          ? error.method
          : undefined,
  }).pipe(Effect.andThen(Effect.fail(new HttpApiError.InternalServerError({}))))
}

function invalid(reason: string) {
  return new SecondBrainInvalidError({ name: "SecondBrainInvalidError", data: { message: reason } })
}

function conflict(reason: string) {
  return new SecondBrainConflictError({ name: "SecondBrainConflictError", data: { message: reason } })
}
