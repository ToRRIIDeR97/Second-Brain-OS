import { Auth } from "@/auth"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"

// Clients can post arbitrary text to /log; bound what reaches the server log.
const MAX_LOG_MESSAGE_LENGTH = 8_192
const MAX_LOG_EXTRA_LENGTH = 8_192

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      const extra = ctx.payload.extra ?? {}
      yield* write(ctx.payload.message.slice(0, MAX_LOG_MESSAGE_LENGTH)).pipe(
        Effect.annotateLogs(
          JSON.stringify(extra).length > MAX_LOG_EXTRA_LENGTH ? { extraOmitted: "metadata too large" } : extra,
        ),
      )
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
