import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import type { BrainProject } from "../../src/project/brain"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer, AppNodeBuilder.build(CrossSpawnSpawner.node)))

function request(route: string, init?: RequestInit) {
  const url = new URL(route, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    // fromWeb already carries the query parameters; repeating url.search would send them twice.
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("second brain project threads HttpApi", () => {
  it.instance(
    "lists Projects with thread directories without migrating opened Workspaces, and ensures idempotently",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const external = yield* tmpdirScoped({ git: true })
        const externalSession = yield* Session.use.create({ title: "external" }).pipe(provideInstanceEffect(external))
        yield* Session.use.create({ title: "brain root" })

        const alpha = yield* request("/second-brain/projects", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Alpha", outcome: "Ship alpha" }),
        }).pipe(Effect.flatMap(json<BrainProject.Info>))
        // A Project created without a linked folder runs in its visible `projects/<name>` folder.
        const alphaDirectory = path.join(test.directory, alpha.location!.path!)
        expect(alpha.location?.path).toBe("projects/Alpha")
        yield* Effect.promise(() => mkdir(alphaDirectory, { recursive: true }))
        yield* Session.use.create({ title: "alpha thread" }).pipe(provideInstanceEffect(alphaDirectory))

        const list = () =>
          request("/second-brain/project-threads", { headers }).pipe(Effect.flatMap(json<BrainProject.ThreadSummary[]>))
        // Listing never turns opened Workspaces into Projects; only an explicit ensure does.
        const first = yield* list()
        expect(first).toHaveLength(1)
        const folder = first.find((item) => item.project.id === alpha.id)
        expect(folder).toMatchObject({
          threadDirectory: alphaDirectory,
          threadDirectoryKind: "project",
          workspace: null,
          rootSessionCount: 1,
        })
        expect(folder?.lastActivityAt).toBeNumber()
        const ensure = (workspaceId: string) =>
          request("/second-brain/projects/workspace", {
            method: "POST",
            headers,
            body: JSON.stringify({ workspaceId }),
          })
        const ensured = yield* ensure(externalSession.projectID).pipe(Effect.flatMap(json<BrainProject.Info>))
        const second = yield* list()
        const linked = second.find((item) => item.project.id !== alpha.id)
        expect(linked?.project.id).toBe(ensured.id)
        expect(linked).toMatchObject({
          threadDirectory: external,
          threadDirectoryKind: "workspace",
          workspace: { id: externalSession.projectID, worktree: external },
          rootSessionCount: 1,
          project: {
            name: path.basename(external),
            status: "active",
            location: { workspaceId: externalSession.projectID, displayPath: external },
          },
        })

        const again = yield* ensure(externalSession.projectID).pipe(Effect.flatMap(json<BrainProject.Info>))
        expect(again.id).toBe(ensured.id)
        expect((yield* ensure("global")).status).toBe(400)
        expect((yield* ensure("does-not-exist")).status).toBe(404)
        expect((yield* list()).length).toBe(2)
      }),
    { git: true },
  )
})

describe("second brain project folders HttpApi", () => {
  it.instance("scans project folders into Projects whose threads run in the folder", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      yield* Effect.promise(() => mkdir(path.join(test.directory, "Projects", "Alpha"), { recursive: true }))
      const scanned = yield* request("/second-brain/projects/scan", { method: "POST", headers }).pipe(
        Effect.flatMap(json<BrainProject.ScanResult>),
      )
      expect(scanned).toEqual({ folders: 1, created: 1, missing: [] })
      const threads = yield* request("/second-brain/project-threads", { headers }).pipe(
        Effect.flatMap(json<BrainProject.ThreadSummary[]>),
      )
      expect(threads.map((entry) => [entry.project.name, entry.threadDirectoryKind, entry.threadDirectory])).toEqual([
        ["Alpha", "project", path.join(test.directory, "Projects", "Alpha")],
      ])
      const linked = yield* request("/second-brain/projects/link", {
        method: "POST",
        headers,
        body: JSON.stringify({ folder: path.join(test.directory, "Projects") }),
      })
      expect(linked.status).toBe(400)
    }),
  )

  it.instance("links a folder outside the workspace as a Project and unlinks it without touching its files", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(() => writeFile(path.join(outside, "notes.md"), "# keep\n"))
      const post = (route: string) =>
        request(route, { method: "POST", headers, body: JSON.stringify({ folder: outside }) }).pipe(
          Effect.flatMap(json<BrainProject.ScanResult>),
        )
      const threads = () =>
        request("/second-brain/project-threads", { headers }).pipe(Effect.flatMap(json<BrainProject.ThreadSummary[]>))

      expect(yield* post("/second-brain/projects/link")).toMatchObject({ folders: 1, created: 1 })
      const linked = (yield* threads()).find((entry) => entry.project.location?.path === outside)
      expect(linked).toMatchObject({ threadDirectory: outside, project: { status: "active" } })
      // The link lives in the workspace manifest, so it survives a reload.
      const manifest = yield* Effect.promise(() =>
        Bun.file(path.join(test.directory, ".tenon", "workspace.json")).json(),
      )
      expect(manifest).toEqual({ version: 1, linkedFolders: [outside] })

      yield* post("/second-brain/projects/unlink")
      const after = (yield* threads()).find((entry) => entry.project.id === linked?.project.id)
      expect(after?.project.status ?? "archived").toBe("archived")
      expect(
        yield* Effect.promise(() => Bun.file(path.join(test.directory, ".tenon", "workspace.json")).json()),
      ).toEqual({ version: 1, linkedFolders: [] })
      expect(yield* Effect.promise(() => readdir(outside))).toContain("notes.md")
    }),
  )
})

describe("second brain errors and recovery HttpApi", () => {
  it.instance("returns the domain reason for rejected requests and lists past stray Project files", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const rejected = yield* request("/second-brain/note?path=outside.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "x", create: true }),
      })
      expect(rejected.status).toBe(400)
      expect(yield* rejected.json).toEqual({ name: "SecondBrainInvalidError", data: { message: "invalid_path" } })

      yield* Effect.promise(() => mkdir(path.join(test.directory, "projects"), { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(test.directory, "projects", "README.md"), "# Projects\n"))
      yield* request("/second-brain/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Alpha", outcome: "Ship alpha" }),
      }).pipe(Effect.flatMap(json<BrainProject.Info>))
      const projects = yield* request("/second-brain/projects", { headers }).pipe(
        Effect.flatMap(json<BrainProject.Info[]>),
      )
      expect(projects.map((project) => project.name)).toEqual(["Alpha"])
    }),
  )

  it.instance("moves an undecodable calendar aside on save instead of failing every save", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const directory = path.join(test.directory, ".tenon")
      yield* Effect.promise(() => mkdir(directory, { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(directory, "calendar-v1.json"), '{"version": 2, "events": ['))

      const broken = yield* request("/second-brain/calendar", { headers })
      expect(broken.status).toBe(400)
      expect(yield* broken.json).toEqual({ name: "SecondBrainInvalidError", data: { message: "invalid_json" } })

      const event = { id: "event_a", title: "Kickoff", date: "2026-08-30", source: "local", syncState: "local" }
      const saved = yield* request("/second-brain/calendar", {
        method: "PUT",
        headers,
        body: JSON.stringify({ events: [event], tasks: [] }),
      }).pipe(Effect.flatMap(json<{ revision: string; events: Array<{ id: string }> }>))
      expect(saved.events.map((item) => item.id)).toEqual(["event_a"])
      const files = yield* Effect.promise(() => readdir(directory))
      expect(files.filter((file) => file.startsWith("calendar-v1.json.corrupt-"))).toHaveLength(1)

      const reloaded = yield* request("/second-brain/calendar", { headers }).pipe(
        Effect.flatMap(json<{ revision: string }>),
      )
      expect(reloaded.revision).toBe(saved.revision)
    }),
  )

  it.instance("moves a legacy .second-brain calendar into .tenon on first read", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory }
      const legacy = path.join(test.directory, ".second-brain")
      const event = { id: "event_a", title: "Kickoff", date: "2026-08-30", source: "local", syncState: "local" }
      const calendar = JSON.stringify({ version: 2, revision: "r1", events: [event], tasks: [] })
      yield* Effect.promise(() => mkdir(legacy, { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(legacy, "calendar-v1.json"), calendar))

      const read = yield* request("/second-brain/calendar", { headers }).pipe(
        Effect.flatMap(json<{ revision: string; events: Array<{ id: string }> }>),
      )
      expect(read.events.map((item) => item.id)).toEqual(["event_a"])
      expect(
        yield* Effect.promise(() => readFile(path.join(test.directory, ".tenon", "calendar-v1.json"), "utf8")),
      ).toBe(calendar)
      // The emptied legacy folder is gone too.
      expect(yield* Effect.promise(() => readdir(test.directory))).not.toContain(".second-brain")
    }),
  )

  it.instance("keeps the .tenon calendar and leaves a legacy copy untouched when both exist", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory }
      const legacy = path.join(test.directory, ".second-brain")
      const current = path.join(test.directory, ".tenon")
      const old = JSON.stringify({ version: 2, revision: "old", events: [], tasks: [] })
      const event = { id: "event_new", title: "Kickoff", date: "2026-08-30", source: "local", syncState: "local" }
      const next = JSON.stringify({ version: 2, revision: "new", events: [event], tasks: [] })
      yield* Effect.promise(() => mkdir(legacy, { recursive: true }))
      yield* Effect.promise(() => mkdir(current, { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(legacy, "calendar-v1.json"), old))
      yield* Effect.promise(() => writeFile(path.join(current, "calendar-v1.json"), next))

      const read = yield* request("/second-brain/calendar", { headers }).pipe(
        Effect.flatMap(json<{ events: Array<{ id: string }> }>),
      )
      expect(read.events.map((item) => item.id)).toEqual(["event_new"])
      expect(yield* Effect.promise(() => readFile(path.join(legacy, "calendar-v1.json"), "utf8"))).toBe(old)
    }),
  )

  it.instance("refuses a calendar from a newer version without moving it aside", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const directory = path.join(test.directory, ".tenon")
      const newer = JSON.stringify({ version: 3, revision: "r", events: [], tasks: [] })
      yield* Effect.promise(() => mkdir(directory, { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(directory, "calendar-v1.json"), newer))

      const saved = yield* request("/second-brain/calendar", {
        method: "PUT",
        headers,
        body: JSON.stringify({ events: [], tasks: [] }),
      })
      expect(saved.status).toBe(400)
      expect(yield* saved.json).toEqual({ name: "SecondBrainInvalidError", data: { message: "unsupported_version" } })
      expect(yield* Effect.promise(() => readdir(directory))).toEqual(["calendar-v1.json"])
    }),
  )

  it.instance("keeps a calendar that parses but fails validation instead of moving it aside", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
      const directory = path.join(test.directory, ".tenon")
      const event = { id: "event_a", title: "Kickoff", date: "2026-08-30", source: "local", syncState: "local" }
      const duplicated = JSON.stringify({ version: 2, revision: "r", events: [event, event], tasks: [] })
      yield* Effect.promise(() => mkdir(directory, { recursive: true }))
      yield* Effect.promise(() => writeFile(path.join(directory, "calendar-v1.json"), duplicated))

      const saved = yield* request("/second-brain/calendar", {
        method: "PUT",
        headers,
        body: JSON.stringify({ events: [event], tasks: [] }),
      })
      expect(saved.status).toBe(400)
      expect(yield* saved.json).toEqual({ name: "SecondBrainInvalidError", data: { message: "duplicate_id" } })
      expect(yield* Effect.promise(() => readdir(directory))).toEqual(["calendar-v1.json"])
    }),
  )
})
