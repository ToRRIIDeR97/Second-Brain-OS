import { HarnessRuntime } from "@opencode-ai/core/harness"
import { HarnessRegistry } from "@opencode-ai/core/harness/registry"
import { HarnessSetup } from "@opencode-ai/core/harness/setup"
import { HarnessUpdate } from "@opencode-ai/core/harness/update"
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
      "harness.refresh",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.refresh(ctx.payload.id))
      }),
    )
    .handle(
      "harness.updates",
      Effect.fn(function* () {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.updates())
      }),
    )
    .handle(
      "harness.upgrade",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.upgrade(ctx.params.id)).pipe(Effect.mapError(httpError))
      }),
    )
    .handle(
      "harness.setup",
      Effect.fn(function* () {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.setup())
      }),
    )
    .handle(
      "harness.install",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.install(ctx.params.id)).pipe(Effect.mapError(httpError))
      }),
    )
    .handle(
      "harness.signIn",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.signIn(ctx.params.id)).pipe(Effect.mapError(httpError))
      }),
    )
    .handle(
      "harness.setKey",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.setApiKey(ctx.params.id, ctx.payload)).pipe(Effect.mapError(httpError))
      }),
    )
    .handle(
      "harness.removeKey",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.setApiKey(ctx.params.id, undefined)).pipe(Effect.mapError(httpError))
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
      "harness.titleAgent",
      Effect.fn(function* () {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.titleAgent().pipe(Effect.map((id) => ({ id }))))
      }),
    )
    .handle(
      "harness.setTitleAgent",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(
          harnesses.setTitleAgent(ctx.payload.id).pipe(Effect.as({ id: ctx.payload.id })),
        ).pipe(Effect.mapError(httpError))
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
      "harness.assistantDirectory",
      Effect.fn(function* () {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.assistantDirectory().pipe(Effect.map((directory) => ({ directory }))))
      }),
    )
    .handle(
      "harness.verify",
      Effect.fn(function* (ctx) {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.verify(ctx.payload)).pipe(Effect.mapError(httpError))
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

function httpError(error: HarnessRegistry.RegisterError | HarnessUpdate.UpdateError | HarnessSetup.SetupError) {
  const fields = { reason: error.reason, message: error.message }
  if (error.reason === "update-failed" || error.reason === "install-failed" || error.reason === "sign-in-failed")
    return new HarnessSettingsWriteError(fields)
  if (error.reason === "not-found") return new HarnessSettingsNotFoundError(fields)
  if (error.reason === "exists") return new HarnessSettingsExistsError(fields)
  if (error.reason === "write-failed") return new HarnessSettingsWriteError(fields)
  return new HarnessSettingsInvalidError(fields)
}
