import { Effect, Exit } from "effect"

export function logStartupTiming(phase: string) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const started = performance.now()
      return effect.pipe(
        Effect.onExit((exit) =>
          Effect.logInfo("startup phase", {
            phase,
            elapsedMs: Math.round(performance.now() - started),
            success: Exit.isSuccess(exit),
          }),
        ),
      )
    })
}
