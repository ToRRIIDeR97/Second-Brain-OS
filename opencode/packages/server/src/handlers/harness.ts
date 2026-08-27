import { HarnessRuntime } from "@opencode-ai/core/harness"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const HarnessHandler = HttpApiBuilder.group(Api, "server.harness", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "harness.list",
      Effect.fn(function* () {
        const harnesses = yield* HarnessRuntime.Service
        return yield* response(harnesses.list())
      }),
    )
  }),
)
