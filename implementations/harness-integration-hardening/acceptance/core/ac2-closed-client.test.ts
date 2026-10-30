import { describe, expect, test } from "bun:test"
import { Effect, Queue, Sink, Stream } from "effect"
import { make } from "../../../../opencode/packages/core/src/harness/codex-app-server"

describe("AC-2 a client whose process exited fails new requests at once", () => {
  test("closed turns true when stdout ends and a later request fails with an exit error", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const incoming = yield* Queue.unbounded<Uint8Array>()
          const client = yield* make({ connection: { stdout: Stream.fromQueue(incoming), stdin: Sink.drain } })
          expect(yield* client.closed).toBe(false)
          yield* Queue.end(incoming)
          yield* Effect.sleep("20 millis")
          expect(yield* client.closed).toBe(true)
          const error = yield* client.request("turn/start", {}).pipe(Effect.timeout("1 second"), Effect.flip)
          expect(error.message).toContain("exited")
        }),
      ),
    )
  })
})
