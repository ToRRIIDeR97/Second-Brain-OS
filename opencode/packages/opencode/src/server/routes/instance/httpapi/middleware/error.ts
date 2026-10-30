import { NamedError } from "@opencode-ai/core/util/error"
import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"
import { Cause, Effect } from "effect"
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http"
import { stat } from "node:fs/promises"

// A workspace whose folder was moved or deleted fails deep inside its per-folder services. When the
// request names a directory that is not there, answer with a typed 404 the app can act on.
const missingDirectory = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const header = request.headers["x-opencode-directory"]
  const query = new URL(request.url, "http://localhost").searchParams
  // Instance routes take `directory`; the location-scoped `/api` routes take `location[directory]`.
  const directory =
    query.get("directory") || query.get("location[directory]") || (header ? decodeURIComponent(header) : undefined)
  if (!directory) return false
  return yield* Effect.promise(() =>
    stat(directory).then(
      (info) => !info.isDirectory(),
      () => true,
    ),
  )
  // A malformed header is not a missing folder; fall through to the 500.
}).pipe(Effect.catchCause(() => Effect.succeed(false)))

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
          if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
          if (HttpServerError.isHttpServerError(reason.defect)) return false
          if (HttpServerRespondable.isRespondable(reason.defect)) return false
          return true
        })
        if (!defect) return yield* Effect.failCause(cause)

        const error = defect.defect
        if (
          ConfigErrorV1.JsonError.isInstance(error) ||
          ConfigErrorV1.InvalidError.isInstance(error) ||
          ConfigErrorV1.FrontmatterError.isInstance(error) ||
          ConfigErrorV1.DirectoryTypoError.isInstance(error)
        ) {
          return HttpServerResponse.jsonUnsafe(error.toObject(), { status: 400 })
        }

        if (yield* missingDirectory) {
          return HttpServerResponse.jsonUnsafe(
            { name: "WorkspaceFolderNotFoundError", data: { message: "The workspace folder was not found." } },
            { status: 404 },
          )
        }

        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        yield* Effect.logError("failed", { ref, error, cause: Cause.pretty(cause) })
        return HttpServerResponse.jsonUnsafe(
          new NamedError.Unknown({
            message: "Unexpected server error. Check server logs for details.",
            ref,
          }).toObject(),
          { status: 500 },
        )
      }),
    ),
  ),
).layer
