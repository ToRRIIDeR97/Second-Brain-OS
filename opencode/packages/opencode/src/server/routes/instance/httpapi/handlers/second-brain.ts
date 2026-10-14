import { InstanceState } from "@/effect/instance-state"
import { KnowledgeNote } from "@/knowledge/note"
import { PlannerCalendar } from "@/planner/calendar"
import { BrainProject } from "@/project/brain"
import { Project } from "@/project/project"
import { Database } from "@opencode-ai/core/database/database"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect, Layer, Semaphore } from "effect"
import path from "node:path"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { SecondBrainConflictError } from "../groups/second-brain"

const CALENDAR_PATH = ".second-brain/calendar-v1.json"

export const secondBrainHandlers = HttpApiBuilder.group(InstanceHttpApi, "secondBrain", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const opencodeProjects = yield* Project.Service
    const database = yield* Database.Service
    // Serializes Project creation from Workspaces so concurrent requests cannot duplicate cards.
    const ensureLock = Semaphore.makeUnsafe(1)
    // Brain directories whose one-shot Workspace migration ran in this server process.
    const migrated = new Set<string>()
    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })
    const projectConflict = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, HttpApiError.BadRequest | SecondBrainConflictError, R> =>
      effect.pipe(
        Effect.catch((error): Effect.Effect<never, HttpApiError.BadRequest | SecondBrainConflictError> => {
          if (error instanceof BrainProject.ConflictError) {
            return Effect.fail(
              new SecondBrainConflictError({
                name: "SecondBrainConflictError",
                data: { message: error.reason },
              }),
            )
          }
          return Effect.fail(new HttpApiError.BadRequest({}))
        }),
      )
    const projectRead = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, HttpApiError.BadRequest | HttpApiError.NotFound, R> =>
      effect.pipe(
        Effect.catch((error): Effect.Effect<never, HttpApiError.BadRequest | HttpApiError.NotFound> => {
          if (error instanceof BrainProject.NotFoundError) return Effect.fail(new HttpApiError.NotFound({}))
          return Effect.fail(new HttpApiError.BadRequest({}))
        }),
      )
    const projectUpdate = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, HttpApiError.BadRequest | HttpApiError.NotFound | SecondBrainConflictError, R> =>
      effect.pipe(
        Effect.catch(
          (error): Effect.Effect<never, HttpApiError.BadRequest | HttpApiError.NotFound | SecondBrainConflictError> => {
            if (error instanceof BrainProject.NotFoundError) return Effect.fail(new HttpApiError.NotFound({}))
            if (error instanceof BrainProject.ConflictError) {
              return Effect.fail(
                new SecondBrainConflictError({
                  name: "SecondBrainConflictError",
                  data: { message: error.reason },
                }),
              )
            }
            return Effect.fail(new HttpApiError.BadRequest({}))
          },
        ),
      )

    const noteRead = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, HttpApiError.BadRequest | HttpApiError.NotFound, R> =>
      effect.pipe(
        Effect.catch((error): Effect.Effect<never, HttpApiError.BadRequest | HttpApiError.NotFound> => {
          if (error instanceof KnowledgeNote.NotFoundError) return Effect.fail(new HttpApiError.NotFound({}))
          return Effect.fail(new HttpApiError.BadRequest({}))
        }),
      )
    const noteWrite = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, HttpApiError.BadRequest | HttpApiError.NotFound | SecondBrainConflictError, R> =>
      effect.pipe(
        Effect.catch(
          (error): Effect.Effect<never, HttpApiError.BadRequest | HttpApiError.NotFound | SecondBrainConflictError> => {
            if (error instanceof KnowledgeNote.NotFoundError) return Effect.fail(new HttpApiError.NotFound({}))
            if (error instanceof KnowledgeNote.ConflictError) {
              return Effect.fail(
                new SecondBrainConflictError({
                  name: "SecondBrainConflictError",
                  data: { message: error.reason },
                }),
              )
            }
            return Effect.fail(new HttpApiError.BadRequest({}))
          },
        ),
      )

    const listNotes = Effect.fn("SecondBrain.listNotes")(function* (ctx: { query: { search?: string } }) {
      return yield* filesystem(KnowledgeNote.list(ctx.query.search)).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const readNote = Effect.fn("SecondBrain.readNote")(function* (ctx: { query: { path: string } }) {
      return yield* noteRead(filesystem(KnowledgeNote.read(ctx.query.path)))
    })

    const writeNote = Effect.fn("SecondBrain.writeNote")(function* (ctx: {
      query: { path: string }
      payload: KnowledgeNote.WriteInput
    }) {
      return yield* noteWrite(filesystem(KnowledgeNote.write(ctx.query.path, ctx.payload)))
    })

    const calendarFile = Effect.fn("SecondBrain.calendarFile")(function* () {
      const target = yield* filesystem(
        LocationMutation.Service.use((mutation) => mutation.resolve({ path: CALENDAR_PATH, kind: "file" })),
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const source = yield* filesystem(FSUtil.Service.use((fs) => fs.readFileStringSafe(target.canonical))).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const snapshot = yield* Effect.try({
        try: () => PlannerCalendar.decode(source),
        catch: () => new HttpApiError.BadRequest({}),
      })
      return { target, source, snapshot }
    })

    const readCalendar = Effect.fn("SecondBrain.readCalendar")(function* () {
      return (yield* calendarFile()).snapshot
    })

    const writeCalendar = Effect.fn("SecondBrain.writeCalendar")(function* (ctx: {
      payload: PlannerCalendar.WriteInput
    }) {
      const current = yield* calendarFile()
      if (ctx.payload.expectedRevision !== undefined && ctx.payload.expectedRevision !== current.snapshot.revision) {
        return yield* new SecondBrainConflictError({
          name: "SecondBrainConflictError",
          data: { message: "stale" },
        })
      }
      const next = yield* Effect.try({
        try: () => PlannerCalendar.encode(ctx.payload.events, ctx.payload.tasks),
        catch: () => new HttpApiError.BadRequest({}),
      })
      yield* filesystem(
        FileMutation.Service.use((mutation) =>
          current.source === undefined
            ? mutation.create({ target: current.target, content: next.source }).pipe(
                Effect.catchTag("FileMutation.TargetExistsError", () =>
                  Effect.fail(
                    new SecondBrainConflictError({
                      name: "SecondBrainConflictError",
                      data: { message: "stale" },
                    }),
                  ),
                ),
              )
            : mutation
                .writeIfUnchanged({
                  target: current.target,
                  content: next.source,
                  expected: new TextEncoder().encode(current.source),
                })
                .pipe(
                  Effect.catchTag("FileMutation.StaleContentError", () =>
                    Effect.fail(
                      new SecondBrainConflictError({
                        name: "SecondBrainConflictError",
                        data: { message: "stale" },
                      }),
                    ),
                  ),
                ),
        ),
      ).pipe(
        Effect.catchTag("PlatformError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        Effect.catchTag("FileSystemError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
      const snapshot = { version: next.version, revision: next.revision, events: next.events, tasks: next.tasks }
      yield* filesystem(BrainProject.syncTimelines(snapshot)).pipe(
        Effect.catch(() =>
          Effect.logWarning("Second Brain project timeline sync failed; project timelines may be stale"),
        ),
      )
      return snapshot
    })

    const listProjects = Effect.fn("SecondBrain.listProjects")(function* () {
      return yield* filesystem(BrainProject.list()).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const createProject = Effect.fn("SecondBrain.createProject")(function* (ctx: {
      payload: BrainProject.CreateInput
    }) {
      const project = yield* projectConflict(filesystem(BrainProject.create(ctx.payload)))
      const snapshot = (yield* calendarFile()).snapshot
      yield* filesystem(BrainProject.syncTimelines(snapshot)).pipe(
        Effect.catch(() =>
          Effect.logWarning("Second Brain project timeline sync failed; project timelines may be stale"),
        ),
      )
      return project
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

    // One-shot migration hook: the Brain location is chosen by the renderer, so the
    // server learns it on the first Project thread listing for that directory.
    const migrateOnce = Effect.fn("SecondBrain.migrateOnce")(function* (known: ReadonlyArray<BrainProject.Workspace>) {
      const brainDirectory = (yield* InstanceState.context).directory
      if (migrated.has(brainDirectory)) return
      const withThreads = yield* BrainProject.workspaceIdsWithThreads().pipe(
        Effect.provideService(Database.Service, database),
      )
      const candidates = BrainProject.migrationCandidates({ workspaces: known, withThreads, brainDirectory })
      const counts = yield* filesystem(BrainProject.migrateWorkspaces(candidates))
      migrated.add(brainDirectory)
      yield* Effect.logInfo("Second Brain workspace migration", { candidates: candidates.length, ...counts })
    })

    const listProjectThreads = Effect.fn("SecondBrain.listProjectThreads")(function* () {
      const known = yield* workspaces()
      yield* ensureLock.withPermits(1)(migrateOnce(known)).pipe(
        Effect.catch(() => Effect.logWarning("Second Brain workspace migration failed; it will retry")),
      )
      return yield* filesystem(
        Effect.gen(function* () {
          const projects = yield* BrainProject.list()
          const resolved = yield* Effect.forEach(
            projects,
            (project) => BrainProject.threadDirectory(project, known).pipe(Effect.map((thread) => ({ project, thread }))),
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
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const ensureWorkspaceProject = Effect.fn("SecondBrain.ensureWorkspaceProject")(function* (ctx: {
      payload: BrainProject.EnsureWorkspaceInput
    }) {
      const id = ctx.payload.workspaceId.trim()
      if (!id || id === "global") return yield* new HttpApiError.BadRequest({})
      const workspace = yield* opencodeProjects.get(ProjectV2.ID.make(id))
      if (!workspace) return yield* new HttpApiError.NotFound({})
      const brainDirectory = (yield* InstanceState.context).directory
      if (path.resolve(workspace.worktree) === path.resolve(brainDirectory)) return yield* new HttpApiError.BadRequest({})
      const result = yield* ensureLock.withPermits(1)(
        projectConflict(
          filesystem(BrainProject.ensureForWorkspace({ id: workspace.id, worktree: workspace.worktree })),
        ),
      )
      return result.project
    })

    const readProject = Effect.fn("SecondBrain.readProject")(function* (ctx: { query: { id: string } }) {
      return yield* projectRead(filesystem(BrainProject.get(ctx.query.id)))
    })

    const updateProject = Effect.fn("SecondBrain.updateProject")(function* (ctx: {
      query: { id: string }
      payload: BrainProject.UpdateInput
    }) {
      return yield* projectUpdate(filesystem(BrainProject.update(ctx.query.id, ctx.payload)))
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
      .handle("readProject", readProject)
      .handle("updateProject", updateProject)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
