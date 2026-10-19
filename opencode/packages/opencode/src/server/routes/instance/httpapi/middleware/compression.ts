import { deflateSync, gzipSync } from "node:zlib"
import { Effect } from "effect"
import { HttpBody, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// Keep the server's compressible content-type set stable across HTTP backend changes.
const COMPRESSIBLE_CONTENT_TYPE_REGEX =
  /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i

const NO_TRANSFORM_REGEX = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i

const THRESHOLD_BYTES = 1024

type Encoding = "gzip" | "deflate"

// Loopback clients gain nothing from compression and would pay its CPU cost on every response.
const LOOPBACK_HOST_REGEX = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i

function pickEncoding(acceptEncoding: string | undefined): Encoding | undefined {
  if (!acceptEncoding) return undefined
  const weights = new Map(
    acceptEncoding
      .toLowerCase()
      .split(",")
      .map((item) => {
        const [name = "", ...params] = item.split(";").map((part) => part.trim())
        const q = params.find((param) => param.startsWith("q="))
        const weight = q === undefined ? 1 : Number(q.slice(2))
        return [name, Number.isFinite(weight) ? weight : 0] as const
      }),
  )
  const weight = (encoding: Encoding) => weights.get(encoding) ?? weights.get("*") ?? 0
  const gzip = weight("gzip")
  const deflate = weight("deflate")
  if (gzip <= 0 && deflate <= 0) return undefined
  return gzip >= deflate ? "gzip" : "deflate"
}

export const compressionLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  Effect.gen(function* () {
    const response = yield* effect
    const request = yield* HttpServerRequest.HttpServerRequest

    if (request.method === "HEAD") return response
    if (response.headers["content-encoding"]) return response
    if (response.headers["transfer-encoding"]) return response

    const body = response.body
    if (body._tag !== "Uint8Array") return response
    if (body.body.byteLength < THRESHOLD_BYTES) return response

    const cacheControl = response.headers["cache-control"]
    if (cacheControl && NO_TRANSFORM_REGEX.test(cacheControl)) return response

    const host = request.headers["host"]
    if (host && LOOPBACK_HOST_REGEX.test(host)) return response

    const contentType = body.contentType
    if (!COMPRESSIBLE_CONTENT_TYPE_REGEX.test(contentType)) return response

    const encoding = pickEncoding(request.headers["accept-encoding"])
    if (!encoding) return response

    const compressed = encoding === "gzip" ? gzipSync(body.body) : deflateSync(body.body)
    return HttpServerResponse.setHeader(
      HttpServerResponse.setBody(response, HttpBody.uint8Array(compressed, contentType)),
      "content-encoding",
      encoding,
    )
  }),
).layer
