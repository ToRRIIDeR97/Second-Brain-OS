import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Queue, Sink, Stream } from "effect"
import { make } from "../../../../opencode/packages/core/src/harness/codex-app-server"

describe("verify AC-2 closed client", () => {
  test("a request in flight when the process exits fails, and the client reports closed", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const incoming = yield* Queue.unbounded<Uint8Array>()
          const client = yield* make({ connection: { stdout: Stream.fromQueue(incoming), stdin: Sink.drain } })
          const pending = yield* Effect.forkScoped(client.request("session/prompt", {}).pipe(Effect.flip))
          yield* Effect.sleep("10 millis")
          yield* Queue.end(incoming)
          const error = yield* Fiber.join(pending).pipe(Effect.timeout("1 second"))
          expect(error.message).toContain("exited")
          expect(yield* client.closed).toBe(true)
        }),
      ),
    )
  })

  test("a read failure also closes the client and later requests fail fast", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* make({
            connection: { stdout: Stream.fail(new Error("pipe broke")) as never, stdin: Sink.drain },
          })
          yield* Effect.sleep("10 millis")
          expect(yield* client.closed).toBe(true)
          const error = yield* client.request("x").pipe(Effect.timeout("1 second"), Effect.flip)
          expect(error.message.length).toBeGreaterThan(0)
        }),
      ),
    )
  })
})
