import { ProxyUtil } from "@/server/proxy-util"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { WebSocketTracker } from "../websocket-tracker"

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  if (request.source instanceof Request && request.source.body === null) return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len ? Number(len) : undefined)
}

export function websocket(
  request: HttpServerRequest.HttpServerRequest,
  target: string | URL,
  extra?: HeadersInit,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Socket.WebSocketConstructor> {
  return Effect.scoped(
    Effect.gen(function* () {
      const inbound = yield* Effect.orDie(request.upgrade)
      const credentials = extra ? new Headers(extra) : undefined
      const outbound = yield* Socket.makeWebSocket(ProxyUtil.websocketTargetURL(target), {
        protocols: ProxyUtil.websocketProtocols(request.headers),
      }).pipe(
        // The target's configured auth headers go on the upstream upgrade too, as they do for HTTP.
        // Bun's and Node's (undici) WebSocket take headers in an options object; browsers don't.
        credentials && [...credentials.keys()].length > 0
          ? Effect.provideService(
              Socket.WebSocketConstructor,
              (url, protocols) =>
                new globalThis.WebSocket(url, { protocols, headers: credentials } as unknown as string[]),
            )
          : (effect) => effect,
      )
      const writeInbound = yield* inbound.writer
      const writeOutbound = yield* outbound.writer
      const closeSocket = (socket: Socket.Socket, write: (event: Socket.CloseEvent) => Effect.Effect<void, unknown>) =>
        socket
          .runRaw(() => Effect.void, {
            onOpen: write(WebSocketTracker.SERVER_CLOSING_EVENT()).pipe(Effect.catch(() => Effect.void)),
          })
          .pipe(
            Effect.timeout("1 second"),
            Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
            Effect.catch(() => Effect.void),
          )
      const closeAccepted = Effect.all([closeSocket(inbound, writeInbound), closeSocket(outbound, writeOutbound)], {
        concurrency: "unbounded",
        discard: true,
      })
      const registered = yield* WebSocketTracker.register(
        Effect.all(
          [
            writeInbound(WebSocketTracker.SERVER_CLOSING_EVENT()),
            writeOutbound(WebSocketTracker.SERVER_CLOSING_EVENT()),
          ],
          { concurrency: "unbounded", discard: true },
        ),
      )
      if (!registered) {
        yield* closeAccepted
        return HttpServerResponse.empty()
      }

      yield* outbound
        .runRaw((message) => writeInbound(message))
        .pipe(
          Effect.catchReason("SocketError", "SocketCloseError", (reason) =>
            writeInbound(new Socket.CloseEvent(reason.code, reason.closeReason)).pipe(Effect.catch(() => Effect.void)),
          ),
          Effect.catch(() =>
            writeInbound(new Socket.CloseEvent(1011, "proxy error")).pipe(Effect.catch(() => Effect.void)),
          ),
          Effect.forkScoped,
        )

      yield* inbound
        .runRaw((message) => {
          return writeOutbound(typeof message === "string" ? message : message.slice())
        })
        .pipe(
          Effect.catch(() => Effect.void),
          Effect.ensuring(writeOutbound(new Socket.CloseEvent()).pipe(Effect.catch(() => Effect.void))),
        )
      return HttpServerResponse.empty()
    }).pipe(Effect.orDie),
  )
}

function statusText(response: unknown) {
  return (response as { source?: Response }).source?.statusText
}

export function http(
  client: HttpClient.HttpClient,
  url: string | URL,
  extra: HeadersInit | undefined,
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.gen(function* () {
    const response = yield* client.execute(
      HttpClientRequest.make(request.method as never)(url, {
        headers: ProxyUtil.headers(request.headers as HeadersInit, extra),
        body: requestBody(request),
      }),
    )
    const headers = new Headers(response.headers as HeadersInit)
    headers.delete("content-encoding")
    headers.delete("content-length")

    // An upstream 5xx from a remote workspace sandbox arrives here as an opaque
    // status — its real cause (and log line) live only inside the sandbox. Buffer
    // the small error body, log it locally so it shows up in the host's log, and
    // forward it unchanged (preserving content-type so the client can still parse
    // the structured error, e.g. its `ref`).
    if (response.status >= 500) {
      // Streamed through like any other body; only its first 2,000 characters are kept for the log.
      const decoder = new TextDecoder()
      let head = ""
      const body = response.stream.pipe(
        Stream.tap((chunk) =>
          Effect.sync(() => {
            if (head.length < 2000) head += decoder.decode(chunk, { stream: true })
          }),
        ),
        Stream.catchCause(() => Stream.empty),
        Stream.ensuring(
          Effect.suspend(() =>
            Effect.logError("workspace proxy upstream error", {
              url: url.toString(),
              method: request.method,
              status: response.status,
              body: head.slice(0, 2000),
            }),
          ),
        ),
      )
      if (!headers.has("content-type")) headers.set("content-type", "application/json")
      return HttpServerResponse.stream(body, { status: response.status, statusText: statusText(response), headers })
    }

    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      statusText: statusText(response),
      headers,
    })
  }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 500 }))))
}

export * as HttpApiProxy from "./proxy"
