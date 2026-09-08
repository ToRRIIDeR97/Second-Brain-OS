import { Cause, Deferred, Effect, Option, Queue, Ref, Schema, type Sink, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"

export interface Notification {
  readonly method: string
  readonly params?: unknown
}

export interface ServerRequest extends Notification {
  readonly id: string | number
}

export class ProtocolError extends Error {
  readonly code?: number
  readonly data?: unknown

  constructor(
    message: string,
    options?: { readonly code?: number; readonly data?: unknown; readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = "CodexProtocolError"
    this.code = options?.code
    this.data = options?.data
  }
}

export interface Client {
  readonly request: (method: string, params?: unknown) => Effect.Effect<unknown, ProtocolError>
  readonly notify: (method: string, params?: unknown) => Effect.Effect<void, ProtocolError>
  readonly notifications: Stream.Stream<Notification, ProtocolError>
}

export interface Connection {
  readonly stdout: Stream.Stream<Uint8Array, PlatformError>
  readonly stdin: Sink.Sink<void, Uint8Array, never, PlatformError>
}

type Pending = {
  readonly method: string
  readonly deferred: Deferred.Deferred<unknown, ProtocolError>
}

const decode = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const encoder = new TextEncoder()

export const make = Effect.fn("CodexAppServer.make")(function* (input: {
  readonly connection: Connection
  readonly handleRequest?: (request: ServerRequest) => Effect.Effect<unknown, ProtocolError>
}) {
  const outgoing = yield* Queue.unbounded<string, Cause.Done<void>>()
  const notifications = yield* Queue.unbounded<Notification, ProtocolError>()
  const pending = yield* Ref.make(new Map<string, Pending>())
  const nextID = yield* Ref.make(1)
  let failure: ProtocolError | undefined

  const fail = (error: ProtocolError) =>
    Effect.sync(() => (failure ??= error)).pipe(
      Effect.andThen(Ref.modify(pending, (current) => [current, new Map()] as const)),
      Effect.flatMap((current) =>
        Effect.forEach(current.values(), (item) => Deferred.fail(item.deferred, error), { discard: true }),
      ),
      Effect.andThen(Queue.fail(notifications, error)),
      Effect.asVoid,
    )

  const send = (message: Record<string, unknown>) =>
    Effect.suspend(() =>
      failure
        ? Effect.fail(failure)
        : Effect.try({
            try: () => `${JSON.stringify(message)}\n`,
            catch: (cause) => new ProtocolError("Failed to encode a Codex app-server message.", { cause }),
          }).pipe(
            Effect.flatMap((line) => Queue.offer(outgoing, line)),
            Effect.asVoid,
          ),
    )

  const respond = (id: string | number, result: unknown) => send({ id, result })
  const respondError = (id: string | number, error: ProtocolError) =>
    send({
      id,
      error: { code: error.code ?? -32603, message: error.message, ...(error.data ? { data: error.data } : {}) },
    })

  const removePending = (id: string) =>
    Ref.update(pending, (current) => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })

  const route = (value: unknown) =>
    Effect.gen(function* () {
      if (!isRecord(value)) return yield* Effect.fail(new ProtocolError("Codex app-server emitted an invalid message."))
      const id = stringOrNumber(value.id)
      const method = typeof value.method === "string" ? value.method : undefined
      if (method && id !== undefined) {
        const request = { id, method, ...(value.params === undefined ? {} : { params: value.params }) }
        yield* (
          input.handleRequest
            ? input.handleRequest(request).pipe(
                Effect.matchEffect({
                  onFailure: (error) => respondError(id, error),
                  onSuccess: (result) => respond(id, result),
                }),
              )
            : respondError(id, new ProtocolError(`Unsupported Codex app-server request: ${method}`, { code: -32601 }))
        ).pipe(Effect.forkScoped)
        return
      }
      if (method) {
        yield* Queue.offer(notifications, {
          method,
          ...(value.params === undefined ? {} : { params: value.params }),
        })
        return
      }
      if (id === undefined)
        return yield* Effect.fail(new ProtocolError("Codex app-server emitted an unroutable message."))
      const key = String(id)
      const item = yield* Ref.modify(pending, (current) => {
        const item = current.get(key)
        if (!item) return [undefined, current] as const
        const next = new Map(current)
        next.delete(key)
        return [item, next] as const
      })
      if (!item) return
      if (isRecord(value.error)) {
        yield* Deferred.fail(
          item.deferred,
          new ProtocolError(typeof value.error.message === "string" ? value.error.message : "Codex request failed.", {
            code: typeof value.error.code === "number" ? value.error.code : undefined,
            data: value.error.data,
          }),
        )
        return
      }
      yield* Deferred.succeed(item.deferred, value.result)
    })

  const handleLine = (line: string) => {
    if (!line.trim()) return Effect.void
    const value = Option.getOrUndefined(decode(line))
    return value === undefined ? Effect.fail(new ProtocolError("Codex app-server emitted invalid JSON.")) : route(value)
  }

  yield* Stream.fromQueue(outgoing).pipe(
    Stream.map((line) => encoder.encode(line)),
    Stream.run(input.connection.stdin),
    Effect.mapError((cause) => new ProtocolError("Failed to write to Codex app-server.", { cause })),
    Effect.catch(fail),
    Effect.forkScoped,
  )

  yield* input.connection.stdout.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.runForEach(handleLine),
    Effect.mapError((cause) =>
      cause instanceof ProtocolError ? cause : new ProtocolError("Failed to read from Codex app-server.", { cause }),
    ),
    Effect.matchEffect({
      onFailure: fail,
      onSuccess: () => fail(new ProtocolError("Codex app-server exited.")),
    }),
    Effect.forkScoped,
  )

  yield* Effect.addFinalizer(() =>
    Queue.end(outgoing).pipe(Effect.andThen(fail(new ProtocolError("Codex app-server client closed."))), Effect.ignore),
  )

  const request = (method: string, params?: unknown) =>
    Effect.gen(function* () {
      const id = yield* Ref.modify(nextID, (current) => [current, current + 1] as const)
      const deferred = yield* Deferred.make<unknown, ProtocolError>()
      yield* Ref.update(pending, (current) => new Map(current).set(String(id), { method, deferred }))
      yield* send({ id, method, ...(params === undefined ? {} : { params }) }).pipe(
        Effect.tapError(() => removePending(String(id))),
      )
      return yield* Deferred.await(deferred).pipe(Effect.onInterrupt(() => removePending(String(id))))
    })

  return {
    request,
    notify: (method: string, params?: unknown) => send({ method, ...(params === undefined ? {} : { params }) }),
    notifications: Stream.fromQueue(notifications),
  } satisfies Client
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : undefined
}
