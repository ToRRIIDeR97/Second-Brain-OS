import { expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { withProviderIdleTimeout } from "@opencode-ai/core/harness"
import { it } from "./lib/effect"

it.effect("fails a stalled provider and keeps responsive streams alive beyond two minutes", () =>
  Effect.gen(function* () {
    const stalled = yield* withProviderIdleTimeout(Stream.never).pipe(Stream.runDrain, Effect.flip, Effect.forkChild)
    yield* TestClock.adjust("2 minutes")
    const failure = yield* Fiber.join(stalled)
    expect(failure.message).toContain("stopped responding")
    const active = yield* withProviderIdleTimeout(
      Stream.fromIterable([1, 2, 3]).pipe(
        Stream.mapEffect((value) => Effect.sleep("50 seconds").pipe(Effect.as(value))),
      ),
    ).pipe(Stream.runCollect, Effect.forkChild)
    yield* TestClock.adjust("150 seconds")
    expect(yield* Fiber.join(active)).toEqual([1, 2, 3])
  }),
)
