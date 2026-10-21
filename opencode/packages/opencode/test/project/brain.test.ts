import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/fixture"
import { PlannerCalendar } from "../../src/planner/calendar"
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
        return {
          operation: "write" as const,
          target: input.target.canonical,
          resource: input.target.resource,
          existed: false,
        }
      }),
    writeIfUnchanged: (input) =>
      Effect.sync(() => {
        mkdirSync(path.dirname(input.target.canonical), { recursive: true })
        writeFileSync(input.target.canonical, input.content)
        return {
          operation: "write" as const,
          target: input.target.canonical,
          resource: input.target.resource,
          existed: true,
        }
      }),
    remove: (input) =>
      Effect.sync(() => {
        const existed = existsSync(input.target.canonical)
        if (existed) rmSync(input.target.canonical)
        return {
          operation: "remove" as const,
          target: input.target.canonical,
          resource: input.target.resource,
          existed,
        }
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
    const card = BrainProject.decode(source, "projects/project_01ABC.md")

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
        Effect.catch((error) =>
          error instanceof BrainProject.InvalidError ? Effect.succeed("typed") : Effect.succeed("defect"),
        ),
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
        Effect.catch((error) =>
          error instanceof BrainProject.InvalidError ? Effect.succeed("typed") : Effect.succeed("defect"),
        ),
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
    const cards = path.join(tmp.path, ".tenon", "projects")
    const folders = existsSync(cards) ? readdirSync(cards) : []
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

describe("BrainProject workspace threads", () => {
  const run = <A, E>(
    directory: string,
    effect: Effect.Effect<A, E, Location.Service | LocationMutation.Service | FSUtil.Service | FileMutation.Service>,
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, {
          directory: AbsolutePath.make(directory),
          project: { id: ProjectV2.ID.global, directory: AbsolutePath.make(directory) },
        }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
        Effect.provide(LayerNode.compile(FileMutation.node)),
      ),
    )

  test("ensureForWorkspace is idempotent and keeps generated names unique", async () => {
    await using tmp = await tmpdir()
    await run(tmp.path, BrainProject.create({ name: "repo", outcome: "Existing unlinked Project" }))
    const workspace = { id: "proj_repo", worktree: "/work/repo" }
    const first = await run(tmp.path, BrainProject.ensureForWorkspace(workspace))
    const second = await run(tmp.path, BrainProject.ensureForWorkspace(workspace))
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.project.id).toBe(first.project.id)
    expect(first.project).toMatchObject({
      name: "repo (2)",
      status: "active",
      location: { workspaceId: "proj_repo", displayPath: "/work/repo" },
    })
    expect(await run(tmp.path, BrainProject.list())).toHaveLength(2)
  })

  test("threadDirectory uses the linked Workspace, else the Project folder (created for flat cards)", async () => {
    await using tmp = await tmpdir()
    const linked = (await run(tmp.path, BrainProject.ensureForWorkspace({ id: "proj_a", worktree: "/work/a" }))).project
    const known = [{ id: "proj_a", worktree: "/work/a" }]
    expect(await run(tmp.path, BrainProject.threadDirectory(linked, known))).toMatchObject({
      kind: "workspace",
      directory: "/work/a",
    })
    // A Workspace the server no longer knows falls back to the Project folder.
    expect(await run(tmp.path, BrainProject.threadDirectory(linked, []))).toMatchObject({
      kind: "folder",
      directory: path.join(tmp.path, linked.folder),
    })

    mkdirSync(path.join(tmp.path, "projects"), { recursive: true })
    writeFileSync(
      path.join(tmp.path, "projects", "project_01FLAT.md"),
      "---\nversion: 2\nid: project_01FLAT\ntitle: Flat\nstatus: active\n---\nFlat card outcome.\n",
    )
    const flat = await run(tmp.path, BrainProject.get("project_01FLAT"))
    const resolved = await run(tmp.path, BrainProject.threadDirectory(flat, known))
    expect(resolved).toMatchObject({ kind: "folder", directory: path.join(tmp.path, "projects", "project_01FLAT") })
    expect(existsSync(path.join(tmp.path, "projects", "project_01FLAT", "notes", ".gitkeep"))).toBe(true)
  })

  test("list skips stray and malformed cards, prefers the managed card, and ignores mismatched ids", async () => {
    await using tmp = await tmpdir()
    const created = await run(tmp.path, BrainProject.create({ name: "Valid", outcome: "Keep listing" }))
    const projects = path.join(tmp.path, "projects")
    mkdirSync(projects, { recursive: true })
    const card = (id: string, title: string) =>
      `---\nversion: 2\nid: ${id}\ntitle: ${title}\nstatus: active\n---\n${title} outcome.\n`
    writeFileSync(path.join(projects, "README.md"), "# Projects\n\nHand-written index.\n")
    writeFileSync(path.join(projects, "project_01BAD.md"), "---\ntitle: [unclosed\n---\nBroken\n")
    writeFileSync(path.join(projects, "project_01DUP.md"), card("project_01DUP", "Flat copy"))
    mkdirSync(path.join(projects, "project_01DUP"))
    writeFileSync(path.join(projects, "project_01DUP", "project.md"), card("project_01DUP", "Managed copy"))
    writeFileSync(path.join(projects, "project_01WRONG.md"), card("project_01OTHER", "Wrong id"))

    const listed = await run(tmp.path, BrainProject.list())
    expect(listed.map((project) => project.name).toSorted()).toEqual(["Managed copy", "Valid"])
    expect(listed.find((project) => project.id === created.id)?.name).toBe("Valid")
    const wrong = await Effect.runPromiseExit(
      BrainProject.get("project_01WRONG").pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, {
          directory: AbsolutePath.make(tmp.path),
          project: { id: ProjectV2.ID.global, directory: AbsolutePath.make(tmp.path) },
        }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
      ),
    )
    expect(Exit.isFailure(wrong) ? Cause.squash(wrong.cause) : undefined).toBeInstanceOf(BrainProject.NotFoundError)
  })

  test("list sorts every card before applying the cap", async () => {
    await using tmp = await tmpdir()
    const projects = path.join(tmp.path, "projects")
    mkdirSync(projects)
    const count = 1_001
    // The oldest card also sorts first by path, so a cap applied before sorting would keep it.
    Array.from({ length: count }, (_, index) => {
      const id = `project_${String(index).padStart(5, "0")}`
      writeFileSync(
        path.join(projects, `${id}.md`),
        `---\nversion: 2\nid: ${id}\ntitle: Card ${index}\nstatus: active\nupdated_at: ${new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString()}\n---\nOutcome.\n`,
      )
    })
    const listed = await run(tmp.path, BrainProject.list())
    expect(listed).toHaveLength(1_000)
    expect(listed[0]?.name).toBe(`Card ${count - 1}`)
    expect(listed.map((project) => project.name)).not.toContain("Card 0")
  })

  test("syncTimelines rewrites only timelines whose items changed", async () => {
    await using tmp = await tmpdir()
    const alpha = await run(tmp.path, BrainProject.create({ name: "Alpha", outcome: "A" }))
    const beta = await run(tmp.path, BrainProject.create({ name: "Beta", outcome: "B" }))
    const timeline = (id: string) =>
      PlannerCalendar.decode(
        readFileSync(path.join(tmp.path, ".tenon", "projects", id, "timeline", "calendar.json"), "utf8"),
      )
    const event = (title: string) => ({
      id: "event_a",
      title,
      date: "2026-08-30",
      projectId: alpha.id,
      source: "local" as const,
      syncState: "local" as const,
    })
    const sync = (revision: string, title: string) =>
      run(tmp.path, BrainProject.syncTimelines({ version: 2, revision, events: [event(title)], tasks: [] }))

    await sync("rev_1", "Kickoff")
    expect(timeline(alpha.id)).toMatchObject({ revision: "rev_1", events: [{ id: "event_a" }] })
    // Beta's slice is still empty, as create wrote it, so its file is left untouched.
    expect(timeline(beta.id)).toMatchObject({ revision: "", events: [] })

    // Only the global revision changed: nothing is rewritten.
    await sync("rev_2", "Kickoff")
    expect(timeline(alpha.id).revision).toBe("rev_1")

    await sync("rev_3", "Renamed kickoff")
    expect(timeline(alpha.id)).toMatchObject({ revision: "rev_3", events: [{ title: "Renamed kickoff" }] })
    expect(timeline(beta.id).revision).toBe("")
  })
})

describe("BrainProject project folders", () => {
  const run = <A, E>(
    directory: string,
    data: string,
    effect: Effect.Effect<
      A,
      E,
      Location.Service | LocationMutation.Service | FSUtil.Service | FileMutation.Service | Global.Service
    >,
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, {
          directory: AbsolutePath.make(directory),
          project: { id: ProjectV2.ID.global, directory: AbsolutePath.make(directory) },
        }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
        Effect.provide(LayerNode.compile(FileMutation.node)),
        Effect.provide(Global.layerWith({ data })),
      ),
    )
  const runExit = <A, E>(
    directory: string,
    data: string,
    effect: Effect.Effect<
      A,
      E,
      Location.Service | LocationMutation.Service | FSUtil.Service | FileMutation.Service | Global.Service
    >,
  ) => run(directory, data, Effect.exit(effect))

  /** The user's layout: `Projects/` (capital P) with plain folders, plus noise that is not a project. */
  const workspace = (root: string) => {
    for (const folder of [
      "Projects/Alpha",
      "Projects/Beta",
      "Projects/.hidden",
      "projects/project_01OLD",
      "development/X",
    ])
      mkdirSync(path.join(root, folder), { recursive: true })
    writeFileSync(path.join(root, "Projects", "notes.md"), "not a folder")
  }

  test("scan gives each projects/ subfolder one card and is idempotent", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "Brain")
    const data = path.join(tmp.path, "data")
    workspace(root)
    expect(await run(root, data, BrainProject.scan())).toEqual({ folders: 2, created: 2, missing: [] })
    expect(existsSync(path.join(root, ".tenon", "workspace.json"))).toBe(true)
    expect(await run(root, data, BrainProject.scan())).toEqual({ folders: 2, created: 0, missing: [] })
    const listed = await run(root, data, BrainProject.list())
    expect(listed.map((project) => project.name).toSorted()).toEqual(["Alpha", "Beta"])
    const alpha = listed.find((project) => project.name === "Alpha")!
    expect(await run(root, data, BrainProject.threadDirectory(alpha))).toMatchObject({
      kind: "project",
      directory: path.join(root, "Projects", "Alpha"),
    })
    // The project folders themselves are untouched; cards live under .tenon.
    expect(readdirSync(path.join(root, "Projects", "Alpha"))).toEqual([])
  })

  test("link adds an outside folder, indexes it for AGENTS.md lookup, and unlink archives its card", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "Brain")
    const data = path.join(tmp.path, "data")
    const outside = path.join(tmp.path, "repos", "tool")
    workspace(root)
    mkdirSync(outside, { recursive: true })
    expect(await run(root, data, BrainProject.link({ folder: outside }))).toEqual({
      folders: 3,
      created: 3,
      missing: [],
    })
    expect(JSON.parse(readFileSync(path.join(data, "workspace-links.json"), "utf8"))).toEqual({ [outside]: root })
    const manifest = JSON.parse(readFileSync(path.join(root, ".tenon", "workspace.json"), "utf8"))
    expect(manifest).toEqual({ version: 1, linkedFolders: [outside] })

    const inside = await runExit(root, data, BrainProject.link({ folder: path.join(root, "development") }))
    expect(Exit.isFailure(inside) ? Cause.squash(inside.cause) : undefined).toMatchObject({
      reason: "overlaps_workspace",
    })
    const relative = await runExit(root, data, BrainProject.link({ folder: "repos/tool" }))
    expect(Exit.isFailure(relative) ? Cause.squash(relative.cause) : undefined).toMatchObject({
      reason: "invalid_folder",
    })

    await run(root, data, BrainProject.unlink({ folder: outside }))
    const tool = (await run(root, data, BrainProject.list())).find((project) => project.name === "tool")
    expect(tool?.status).toBe("archived")
    expect(JSON.parse(readFileSync(path.join(data, "workspace-links.json"), "utf8"))).toEqual({})
  })

  test("a manifest that cannot be read is never overwritten", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "Brain")
    mkdirSync(path.join(root, ".tenon"), { recursive: true })
    writeFileSync(path.join(root, ".tenon", "workspace.json"), "{ hand edited")
    const exit = await runExit(root, path.join(tmp.path, "data"), BrainProject.scan())
    expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({ reason: "invalid_manifest" })
    expect(readFileSync(path.join(root, ".tenon", "workspace.json"), "utf8")).toBe("{ hand edited")
  })

  test("instructions read, write and remove the folder's own AGENTS.md", async () => {
    await using tmp = await tmpdir()
    const data = path.join(tmp.path, "data")
    expect(await run(tmp.path, data, BrainProject.readInstructions())).toEqual({
      path: path.join(tmp.path, "AGENTS.md"),
      content: null,
    })
    expect((await run(tmp.path, data, BrainProject.writeInstructions({ content: "Be brief." }))).content).toBe(
      "Be brief.",
    )
    expect((await run(tmp.path, data, BrainProject.removeInstructions())).content).toBeNull()
  })
})
