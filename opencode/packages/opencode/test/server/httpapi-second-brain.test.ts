import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { mkdir } from "node:fs/promises"
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
    HttpClientRequest.setUrl(url.pathname + url.search),
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
    "lists Projects with thread directories, migrates Workspaces with threads once, and ensures idempotently",
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
        const alphaDirectory = path.join(test.directory, alpha.folder)
        yield* Effect.promise(() => mkdir(alphaDirectory, { recursive: true }))
        yield* Session.use.create({ title: "alpha thread" }).pipe(provideInstanceEffect(alphaDirectory))

        const list = () =>
          request("/second-brain/project-threads", { headers }).pipe(
            Effect.flatMap(json<BrainProject.ThreadSummary[]>),
          )
        const first = yield* list()
        expect(first).toHaveLength(2)
        const folder = first.find((item) => item.project.id === alpha.id)
        expect(folder).toMatchObject({
          threadDirectory: alphaDirectory,
          threadDirectoryKind: "folder",
          workspace: null,
          rootSessionCount: 1,
        })
        expect(folder?.lastActivityAt).toBeNumber()
        const linked = first.find((item) => item.project.id !== alpha.id)
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

        const second = yield* list()
        expect(second.map((item) => item.project.id).toSorted()).toEqual(first.map((item) => item.project.id).toSorted())

        const ensure = (workspaceId: string) =>
          request("/second-brain/projects/workspace", {
            method: "POST",
            headers,
            body: JSON.stringify({ workspaceId }),
          })
        const ensured = yield* ensure(externalSession.projectID).pipe(Effect.flatMap(json<BrainProject.Info>))
        expect(ensured.id).toBe(linked!.project.id)
        expect((yield* ensure("global")).status).toBe(400)
        expect((yield* ensure("does-not-exist")).status).toBe(404)
        expect((yield* list()).length).toBe(2)
      }),
    { git: true },
  )
})
