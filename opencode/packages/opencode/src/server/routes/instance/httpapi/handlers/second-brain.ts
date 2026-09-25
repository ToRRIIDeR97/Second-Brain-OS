import { InstanceState } from "@/effect/instance-state"
import { KnowledgeNote } from "@/knowledge/note"
import { PlannerCalendar } from "@/planner/calendar"
import { BrainProject } from "@/project/brain"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { SecondBrainConflictError } from "../groups/second-brain"

const CALENDAR_PATH = ".second-brain/calendar-v1.json"

export const secondBrainHandlers = HttpApiBuilder.group(InstanceHttpApi, "secondBrain", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
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

    const listNotes = Effect.fn("SecondBrain.listNotes")(function* () {
      return yield* filesystem(KnowledgeNote.list()).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
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
      yield* filesystem(BrainProject.syncTimelines(snapshot)).pipe(Effect.catch(() => Effect.void))
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
      yield* filesystem(BrainProject.syncTimelines(snapshot)).pipe(Effect.catch(() => Effect.void))
      return project
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
      .handle("readProject", readProject)
      .handle("updateProject", updateProject)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
