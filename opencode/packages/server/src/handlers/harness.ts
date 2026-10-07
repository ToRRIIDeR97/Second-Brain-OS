import { HarnessRuntime } from "@opencode-ai/core/harness"
import { HarnessRegistry } from "@opencode-ai/core/harness/registry"
import {
  HarnessSettingsExistsError,
  HarnessSettingsInvalidError,
  HarnessSettingsNotFoundError,
  HarnessSettingsWriteError,
} from "@opencode-ai/protocol/groups/harness"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const HarnessHandler = HttpApiBuilder.group(Api, "server.harness", (handlers) =>
  handlers
    .handle(
      "harness.list",
      Effect.fn(function* () {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.list())
      }),
    )
    .handle(
      "harness.settings",
      Effect.fn(function* () {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.settings())
      }),
    )
    .handle(
      "harness.discover",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.discover(ctx.payload)).pipe(Effect.mapError(httpError))
      }),
    )
    .handle(
      "harness.add",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.add(ctx.payload)).pipe(Effect.mapError(httpError))
      }),
    )
    .handle(
      "harness.update",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.setEnabled(ctx.params.id, ctx.payload.enabled)).pipe(
          Effect.mapError(httpError),
        )
      }),
    )
    .handle(
      "harness.remove",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.remove(ctx.params.id).pipe(Effect.as({ id: ctx.params.id }))).pipe(
          Effect.mapError(httpError),
        )
      }),
    ),
)

function httpError(error: HarnessRegistry.RegisterError) {
  const fields = { reason: error.reason, message: error.message }
  if (error.reason === "not-found") return new HarnessSettingsNotFoundError(fields)
  if (error.reason === "exists") return new HarnessSettingsExistsError(fields)
  if (error.reason === "write-failed") return new HarnessSettingsWriteError(fields)
  return new HarnessSettingsInvalidError(fields)
}
