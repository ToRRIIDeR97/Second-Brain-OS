import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/fixture"
import { BrainProject } from "../../src/project/brain"

/** Real file mutations except `create`, which always reports the target as existing. */
const failingCreateLayer = Layer.succeed(
  FileMutation.Service,
  FileMutation.Service.of({
    create: (input) => Effect.fail(new FileMutation.TargetExistsError({ path: input.target.canonical })),
    write: (input) =>
      Effect.sync(() => {
        mkdirSync(path.dirname(input.target.canonical), { recursive: true })
        writeFileSync(input.target.canonical, input.content)
        return {
          operation: "write" as const,
          target: input.target.canonical,
          resource: input.target.resource,
          existed: existsSync(input.target.canonical),
        }
      }),
    writeTextPreservingBom: (input) =>
      Effect.sync(() => {
        mkdirSync(path.dirname(input.target.canonical), { recursive: true })
        writeFileSync(input.target.canonical, input.content)
        return { operation: "write" as const, target: input.target.canonical, resource: input.target.resource, existed: false }
      }),
    writeIfUnchanged: (input) =>
      Effect.sync(() => {
        mkdirSync(path.dirname(input.target.canonical), { recursive: true })
        writeFileSync(input.target.canonical, input.content)
        return { operation: "write" as const, target: input.target.canonical, resource: input.target.resource, existed: true }
      }),
    remove: (input) =>
      Effect.sync(() => {
        const existed = existsSync(input.target.canonical)
        if (existed) rmSync(input.target.canonical)
        return { operation: "remove" as const, target: input.target.canonical, resource: input.target.resource, existed }
      }),
  }),
)

describe("BrainProject cards", () => {
  test("migrates v1 metadata while preserving unknown fields and the Markdown body", () => {
    const source = `---
version: 1
id: project_01ABC
type: project
title: Ship the desktop app
status: active
workspace_id: workspace_01ABC
workspace_path: C:/Projects/desktop
tags: [desktop]
updated: 2026-08-25T00:00:00.000Z
custom_field: keep-me
---
# Ship the desktop app

Release an installable beta.

## Notes

Keep this body intact.
`
    const card = BrainProject.decode(source)

    expect(card.info.outcome).toBe("Release an installable beta.")
    expect(card.info.folder).toBe("projects/project_01ABC")
    expect(card.info.location).toEqual({ workspaceId: "workspace_01ABC", displayPath: "C:/Projects/desktop" })

    const encoded = BrainProject.encode(card.info, card.data, card.body)
    expect(encoded).toContain("version: 2")
    expect(encoded).toContain("custom_field: keep-me")
    expect(encoded).not.toContain("workspace_id:")
    expect(encoded).toContain("## Notes\n\nKeep this body intact.")
  })

  test("projects the global calendar into one managed timeline", () => {
    const snapshot = {
      version: 2 as const,
      revision: "revision_1",
      events: [
        {
          id: "event_a",
          title: "A",
          date: "2026-08-30",
          projectId: "project_01ABC",
          source: "local" as const,
          syncState: "local" as const,
        },
        {
          id: "event_b",
          title: "B",
          date: "2026-08-30",
          projectId: "project_OTHER",
          source: "local" as const,
          syncState: "local" as const,
        },
      ],
      tasks: [],
    }

    expect(BrainProject.projectTimeline(snapshot, "project_01ABC").events.map((event) => event.id)).toEqual(["event_a"])
  })

  test("create rejects invalid names with a typed failure instead of a defect", async () => {
    await using tmp = await tmpdir()
    const directory = AbsolutePath.make(tmp.path)
    const outcome = await Effect.runPromise(
      BrainProject.create({ name: "x".repeat(201), outcome: "Ship it" }).pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
        Effect.provide(LayerNode.compile(FileMutation.node)),
        Effect.catch((error) => (error instanceof BrainProject.InvalidError ? Effect.succeed("typed") : Effect.succeed("defect"))),
      ),
    )
    expect(outcome).toBe("typed")
  })

  test("create rejects progress values outside 0-100 with a typed failure", async () => {
    await using tmp = await tmpdir()
    const directory = AbsolutePath.make(tmp.path)
    const existing = `---\nversion: 2\nid: project_01ABC\ntype: project\ntitle: Alpha\noutcome: Ship it\nstatus: active\nprogress_percent: 0\n---\n# Alpha\n`
    mkdirSync(path.join(tmp.path, "projects", "project_01ABC"), { recursive: true })
    writeFileSync(path.join(tmp.path, "projects", "project_01ABC", "project.md"), existing)
    const outcome = await Effect.runPromise(
      BrainProject.update("project_01ABC", { progressPercent: 101 }).pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
        Effect.provide(LayerNode.compile(FileMutation.node)),
        Effect.catch((error) => (error instanceof BrainProject.InvalidError ? Effect.succeed("typed") : Effect.succeed("defect"))),
      ),
    )
    expect(outcome).toBe("typed")
  })

  test("duplicate create fails without leaving an orphaned project folder", async () => {
    await using tmp = await tmpdir()
    const directory = AbsolutePath.make(tmp.path)
    const first = await Effect.runPromise(
      BrainProject.create({ name: "Alpha", outcome: "Ship it" }).pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
        Effect.provide(LayerNode.compile(FileMutation.node)),
      ),
    )
    expect(first.name).toBe("Alpha")
    const second = await Effect.runPromiseExit(
      BrainProject.create({ name: "Alpha", outcome: "Again" }).pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
        Effect.provide(LayerNode.compile(FileMutation.node)),
      ),
    )
    expect(Exit.isFailure(second)).toBe(true)
    expect(Exit.isFailure(second) ? Cause.squash(second.cause) : undefined).toBeInstanceOf(BrainProject.ConflictError)
    const folders = existsSync(path.join(tmp.path, "projects")) ? readdirSync(path.join(tmp.path, "projects")) : []
    expect(folders).toHaveLength(1)
  })

  test("a failed card create leaves no orphaned derived files", async () => {
    await using tmp = await tmpdir()
    const directory = AbsolutePath.make(tmp.path)
    const exit = await Effect.runPromiseExit(
      BrainProject.create({ name: "Alpha", outcome: "Ship it" }).pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
        Effect.provide(failingCreateLayer),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toBeInstanceOf(BrainProject.ConflictError)
    expect(existsSync(path.join(tmp.path, "projects"))).toBe(false)
  })
})
