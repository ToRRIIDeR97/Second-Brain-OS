import { afterEach, describe, expect, test } from "bun:test"
import { Context, Config as EffectConfig, Effect, Layer, Queue, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import path from "path"
import { pathToFileURL } from "url"
import { mkdir } from "fs/promises"
import { Location } from "@opencode-ai/core/location"
import { Pty } from "@opencode-ai/core/pty"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const context = Context.empty() as Context.Context<unknown>
const testPty = process.platform === "win32" ? test.skip : test

function request(route: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)

const servedRoutes: Layer.Layer<never, EffectConfig.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)

const effectIt = testEffect(
  Layer.mergeAll(
    testStateLayer,
    Socket.layerWebSocketConstructorGlobal,
    servedRoutes.pipe(
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
)

const directoryHeader = (dir: string) => HttpClientRequest.setHeader("x-opencode-directory", dir)

const serverUrl = () => HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address)))

// Under full-suite load PTY spawn, exit, and websocket delivery can take seconds. Waits are bounded by
// a condition plus a generous deadline that still fails well inside the 30s per-test timeout, so a
// real hang reports what was missing instead of an opaque test timeout.
const WAIT_MS = 15_000

// The meta frame (0x00 + JSON cursor) is the first frame the server sends after attaching. Receiving it
// proves the server socket is open and reading, so input written afterwards cannot be dropped.
const META_FRAME = '\u0000{"cursor"'

const createPty = (dir: string, input: Record<string, unknown>) =>
  Effect.acquireRelease(
    HttpClientRequest.post("/api/pty").pipe(
      directoryHeader(dir),
      HttpClientRequest.bodyJson(input),
      Effect.flatMap(HttpClient.execute),
      Effect.tap((created) => Effect.sync(() => expect(created.status).toBe(200))),
      Effect.flatMap((created) => created.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Location.response(Pty.Info))),
      Effect.map((body) => body.data),
    ),
    // Always remove the session, even when an assertion fails, so a long-running PTY never outlives its
    // test. A 404 after the test already removed it is expected.
    (info) =>
      HttpClientRequest.delete(`/api/pty/${info.id}`).pipe(directoryHeader(dir), HttpClient.execute, Effect.ignore),
  )

const connectPty = (dir: string, id: string, cursor: number) =>
  Effect.gen(function* () {
    const socket = yield* Socket.makeWebSocket(
      `${(yield* serverUrl()).replace(/^http/, "ws")}/api/pty/${id}/connect?cursor=${cursor}&location[directory]=${encodeURIComponent(dir)}`,
      { closeCodeIsError: () => false },
    )
    const messages = yield* Queue.unbounded<string>()
    yield* socket
      .runRaw((message) =>
        Queue.offer(messages, typeof message === "string" ? message : new TextDecoder().decode(message)),
      )
      .pipe(
        Effect.catch(() => Effect.void),
        Effect.forkScoped,
      )
    const write = yield* socket.writer
    let seen = ""
    const takeUntil = (expected: string): Effect.Effect<string, unknown> =>
      Effect.gen(function* () {
        while (!seen.includes(expected)) seen += yield* Queue.take(messages)
        return seen
      }).pipe(
        Effect.timeoutOrElse({
          duration: WAIT_MS,
          orElse: () =>
            Effect.fail(
              new Error(`timed out waiting for ${JSON.stringify(expected)}; received ${JSON.stringify(seen)}`),
            ),
        }),
      )
    return { write, takeUntil }
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("v2 pty HttpApi", () => {
  testPty("serves location-wrapped PTY routes and retains exited sessions", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const empty = await request("/api/pty", tmp.path)
    expect(empty.status).toBe(200)
    expect(Schema.decodeUnknownSync(Location.response(Schema.Array(Pty.Info)))(await empty.json()).data).toEqual([])

    const created = await request("/api/pty", tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "exit 4"], title: "v2" }),
    })
    expect(created.status).toBe(200)
    const body = Schema.decodeUnknownSync(Location.response(Pty.Info))(await created.json())
    expect(String(body.location.directory)).toBe(tmp.path)
    expect(body.data.title).toBe("v2")

    // The canonical surface keeps exited sessions observable with their exit code.
    const deadline = Date.now() + WAIT_MS
    let info: { status: string; exitCode?: number } | undefined
    while (Date.now() < deadline) {
      const found = await request(`/api/pty/${body.data.id}`, tmp.path)
      expect(found.status).toBe(200)
      info = Schema.decodeUnknownSync(Location.response(Pty.Info))(await found.json()).data
      if (info.status === "exited") break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(info).toMatchObject({ status: "exited", exitCode: 4 })

    const removed = await request(`/api/pty/${body.data.id}`, tmp.path, { method: "DELETE" })
    expect(removed.status).toBe(204)

    const missing = await request(`/api/pty/${body.data.id}`, tmp.path)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ _tag: "PtyNotFoundError", ptyID: body.data.id })
  })

  testPty("rejects connect tokens without the CSRF header and connects with a valid ticket", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const created = await request("/api/pty", tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "sleep 30"] }),
    })
    expect(created.status).toBe(200)
    const info = Schema.decodeUnknownSync(Location.response(Pty.Info))(await created.json()).data

    try {
      const forbidden = await request(`/api/pty/${info.id}/connect-token`, tmp.path, { method: "POST" })
      expect(forbidden.status).toBe(403)
      expect(await forbidden.json()).toMatchObject({ _tag: "ForbiddenError" })

      const token = await request(`/api/pty/${info.id}/connect-token`, tmp.path, {
        method: "POST",
        headers: { "x-opencode-ticket": "1" },
      })
      expect(token.status).toBe(200)
      const ticket = Schema.decodeUnknownSync(Location.response(PtyTicket.ConnectToken))(await token.json()).data.ticket
      expect(ticket).toBeTruthy()

      const invalid = await request(`/api/pty/${info.id}/connect?ticket=not-a-ticket`, tmp.path)
      expect(invalid.status).toBe(403)
    } finally {
      await request(`/api/pty/${info.id}`, tmp.path, { method: "DELETE" })
    }
  })
  ;(process.platform === "win32" ? effectIt.live.skip : effectIt.live)(
    "serves PTY websocket output and input through the canonical route",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
        const info = yield* createPty(dir, { command: "/bin/cat", title: "v2-websocket" })
        const { write, takeUntil } = yield* connectPty(dir, info.id, -1)

        yield* takeUntil(META_FRAME)
        yield* write("ping-v2\n")
        expect(yield* takeUntil("ping-v2")).toContain("ping-v2")
        yield* write(new Socket.CloseEvent(1000, "done")).pipe(Effect.catch(() => Effect.void))

        const removed = yield* HttpClientRequest.delete(`/api/pty/${info.id}`).pipe(
          directoryHeader(dir),
          HttpClient.execute,
        )
        expect(removed.status).toBe(204)
      }),
  )
  ;(process.platform === "win32" ? effectIt.live.skip : effectIt.live)(
    "applies plugin shell environment before forced PTY values",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
        const plugin = path.join(dir, "plugin.ts")
        const cwd = path.join(dir, "child")
        yield* Effect.promise(() => mkdir(cwd))
        yield* Effect.promise(() =>
          Bun.write(
            plugin,
            [
              "export default async () => ({",
              '  "shell.env": (input, output) => {',
              '    output.env.SHARED = "plugin"',
              '    output.env.PLUGIN = "plugin"',
              '    output.env.TERM = "plugin"',
              "    output.env.HOOK_CWD = input.cwd",
              "  },",
              "})",
              "",
            ].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({ plugin: [pathToFileURL(plugin).href], formatter: false, lsp: false }),
          ),
        )

        const info = yield* createPty(dir, {
          command: "/bin/sh",
          args: ["-c", 'printf "%s|%s|%s|%s|%s\\n" "$CALLER" "$SHARED" "$PLUGIN" "$TERM" "$HOOK_CWD"; sleep 30'],
          cwd,
          env: { CALLER: "caller", SHARED: "caller", TERM: "caller" },
        })
        const { write, takeUntil } = yield* connectPty(dir, info.id, 0)

        expect(yield* takeUntil(`caller|plugin|plugin|xterm-256color|${cwd}`)).toContain(
          `caller|plugin|plugin|xterm-256color|${cwd}`,
        )
        yield* write(new Socket.CloseEvent(1000, "done")).pipe(Effect.catch(() => Effect.void))
      }),
  )
})
