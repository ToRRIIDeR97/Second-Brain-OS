import { EventV2 } from "@opencode-ai/core/event"
import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { Effect, Option, Result, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"

const subscriberCapacity = 256
const encodeEvent = Schema.encodeUnknownOption(OpenCodeEvent)

// The bus also carries events outside the served schema (for example TUI events).
// Encoding them would fail and end the stream for every subscriber, so drop them.
function eventData(event: { readonly type: string }) {
  return Option.match(encodeEvent(event), {
    onNone: () =>
      Effect.logDebug("skipping event outside the server event schema").pipe(
        Effect.annotateLogs({ type: event.type }),
        Effect.as(Result.failVoid),
      ),
    onSome: (encoded) =>
      Effect.succeed(
        Result.succeed<Sse.Event>({ _tag: "Event", event: "message", id: undefined, data: JSON.stringify(encoded) }),
      ),
  })
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        const connected = {
          id: EventV2.ID.create(),
          type: "server.connected",
          data: {},
        }
        const output = Stream.unwrap(
          Effect.gen(function* () {
            // Acquiring the bounded stream installs its listener before readiness is observable.
            const live = yield* EventV2.allBounded(events, subscriberCapacity)
            return Stream.make(connected).pipe(Stream.concat(live))
          }),
        ).pipe(Stream.filterMapEffect(eventData), Stream.pipeThroughChannel(Sse.encode()))
        const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
        return HttpServerResponse.stream(
          output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
          {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          },
        )
      }),
    )
  }),
)
