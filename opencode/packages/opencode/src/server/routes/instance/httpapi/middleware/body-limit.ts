import { Effect, FileSystem } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// Largest request body the server buffers. Prompts carry image attachments as base64 JSON, so the
// cap matches the 32 MiB session export limit instead of a smaller API-only value.
export const MAX_BODY_BYTES = 32 * 1024 * 1024

// Rejects a declared oversized body up front with 413. MaxBodySize also stops a chunked body
// without content-length once it passes the cap while the payload is buffered.
export const bodyLimitLayer = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (Number(request.headers["content-length"]) > MAX_BODY_BYTES)
        return HttpServerResponse.empty({ status: 413 })
      return yield* effect.pipe(Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(MAX_BODY_BYTES)))
    }),
  { global: true },
)
