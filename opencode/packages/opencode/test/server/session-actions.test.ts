import { afterEach, describe, expect, mock } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Schema } from "effect"
import { Session as SessionNs } from "@/session/session"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(LayerNode.compile(SessionNs.node), httpApiLayer))

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

describe("session action routes", () => {
  it.instance(
    "session routes expose metadata on create, update, get, and fork",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "Content-Type": "application/json" }

        const created = yield* requestInDirectory("/session", test.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "meta-session",
            metadata: { source: "sdk", trace: { id: "abc" } },
          }),
        })
        expect(created.status).toBe(200)

        const session = (yield* created.json) as SessionNs.Info
        expect(session.metadata).toEqual({ source: "sdk", trace: { id: "abc" } })

        const updated = yield* requestInDirectory(`/session/${session.id}`, test.directory, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ metadata: { source: "sdk", trace: { id: "def" }, tags: ["one"] } }),
        })
        expect(updated.status).toBe(200)

        const next = (yield* updated.json) as SessionNs.Info
        expect(next.metadata).toEqual({ source: "sdk", trace: { id: "def" }, tags: ["one"] })

        const fetched = yield* requestInDirectory(`/session/${session.id}`, test.directory)
        expect(fetched.status).toBe(200)
        expect(((yield* fetched.json) as SessionNs.Info).metadata).toEqual(next.metadata)

        const forked = yield* requestInDirectory(`/session/${session.id}/fork`, test.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(forked.status).toBe(200)

        const fork = (yield* forked.json) as SessionNs.Info
        expect(fork.metadata).toEqual(next.metadata)

        const reset = yield* requestInDirectory(`/session/${session.id}`, test.directory, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ metadata: {} }),
        })
        expect(reset.status).toBe(200)
        expect(((yield* reset.json) as SessionNs.Info).metadata).toEqual({})

        yield* SessionNs.Service.use((svc) => svc.remove(fork.id).pipe(Effect.ignore))
        yield* SessionNs.Service.use((svc) => svc.remove(session.id).pipe(Effect.ignore))
      }),
    { git: true },
  )

  it.instance(
    "abort route returns success",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )

        const res = yield* requestInDirectory(`/session/${session.id}/abort`, test.directory, { method: "POST" })

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "experimental background route is a no-op without synchronous subagents",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(SessionNs.use.create({}), (created) =>
          SessionNs.use.remove(created.id).pipe(Effect.ignore),
        )

        const res = yield* requestInDirectory(`/experimental/session/${session.id}/background`, test.directory, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "experimental session list returns a cursor that keeps tied sessions",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const created = yield* Effect.forEach([1, 2, 3], () =>
          Effect.acquireRelease(SessionNs.use.create({}), (item) => SessionNs.use.remove(item.id).pipe(Effect.ignore)),
        )
        const time = Date.now() + 60_000
        yield* Effect.forEach(created, (item) =>
          SessionNs.use.setAgentModel({
            sessionID: item.id,
            agent: "build",
            model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
            time,
          }),
        )

        const directory = encodeURIComponent(test.directory)
        const first = yield* requestInDirectory(`/experimental/session?directory=${directory}&limit=2`, test.directory)
        expect(first.status).toBe(200)
        const cursor = first.headers["x-next-cursor"]
        expect(cursor).toBeTruthy()
        const next = yield* requestInDirectory(
          `/experimental/session?directory=${directory}&limit=10&cursor=${cursor}`,
          test.directory,
        )
        expect(next.status).toBe(200)
        const decode = Schema.decodeUnknownSync(Schema.Array(SessionNs.GlobalInfo))
        const ids = [...decode(yield* first.json), ...decode(yield* next.json)].map((item) => item.id)
        expect(ids.toSorted()).toEqual(created.map((item) => item.id).toSorted())

        const legacy = yield* requestInDirectory(`/experimental/session?cursor=${time + 1}`, test.directory)
        expect(legacy.status).toBe(200)
        const invalid = yield* requestInDirectory("/experimental/session?cursor=not-a-cursor", test.directory)
        expect(invalid.status).toBe(400)
      }),
    { git: true },
  )
})
