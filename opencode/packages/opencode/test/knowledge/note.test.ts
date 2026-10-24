import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, open, readFile, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/fixture"
import { KnowledgeNote } from "../../src/knowledge/note"

describe("KnowledgeNote", () => {
  test("adds project metadata without losing unknown frontmatter or Markdown", () => {
    const source = `---\nowner: me\n---\n# Research note\n\nKeep **this** body.\n`
    const card = KnowledgeNote.decode("notes/research.md", source)
    const next = KnowledgeNote.encode(
      {
        ...card.info,
        projectIds: ["project_01K4B"],
        tags: ["research"],
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
      card.data,
      card.body,
    )

    expect(next).toContain("owner: me")
    expect(next).toContain("project_01K4B")
    expect(next).toContain("Keep **this** body.")
    expect(KnowledgeNote.decode("notes/research.md", next).info.title).toBe("Research note")
  })

  test("derives bounded wiki links from note content", () => {
    const note = KnowledgeNote.decode(
      "notes/research.md",
      "# Research\n\nSee [[Project plan]], [[notes/meeting.md|the meeting]], and [[Project plan]].",
    )

    expect(note.info.links).toEqual(["Project plan", "notes/meeting.md"])
  })
})

test("body-only searches return summaries within the selected workspace", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "notes"))
  await writeFile(path.join(tmp.path, "notes", "alpha.md"), "# Alpha\n\nUnique-body-needle")
  await writeFile(path.join(tmp.path, "notes", "beta.md"), "# Beta\n\nOther content")
  const directory = AbsolutePath.make(tmp.path)
  const found = await Effect.runPromise(
    KnowledgeNote.list("UNIQUE-BODY-NEEDLE").pipe(
      Effect.provide(LocationMutation.locationLayer),
      Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
      Effect.provide(LayerNode.compile(FSUtil.node)),
    ),
  )
  expect(found.map((note) => note.title)).toEqual(["Alpha"])
  expect(found[0]).not.toHaveProperty("body")
})

test("note writes reject invalid titles with a typed failure instead of a defect", async () => {
  await using tmp = await tmpdir()
  const directory = AbsolutePath.make(tmp.path)
  const outcome = await Effect.runPromise(
    KnowledgeNote.write("notes/bad.md", { body: "hello", create: true, title: "x".repeat(201) }).pipe(
      Effect.provide(LocationMutation.locationLayer),
      Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
      Effect.provide(LayerNode.compile(FSUtil.node)),
      Effect.provide(LayerNode.compile(FileMutation.node)),
      Effect.catch((error) =>
        error instanceof KnowledgeNote.InvalidError ? Effect.succeed("typed") : Effect.succeed("defect"),
      ),
    ),
  )
  expect(outcome).toBe("typed")
})

test("note writes reject invalid project ids with a typed failure instead of a defect", async () => {
  await using tmp = await tmpdir()
  const directory = AbsolutePath.make(tmp.path)
  const outcome = await Effect.runPromise(
    KnowledgeNote.write("notes/bad.md", { body: "hello", create: true, projectIds: ["not_a_project"] }).pipe(
      Effect.provide(LocationMutation.locationLayer),
      Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
      Effect.provide(LayerNode.compile(FSUtil.node)),
      Effect.provide(LayerNode.compile(FileMutation.node)),
      Effect.catch((error) =>
        error instanceof KnowledgeNote.InvalidError ? Effect.succeed("typed") : Effect.succeed("defect"),
      ),
    ),
  )
  expect(outcome).toBe("typed")
})

test("list caps the filtered, sorted result instead of the raw glob slice", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "notes"))
  const count = 520
  const name = (index: number) => `note-${String(index).padStart(4, "0")}`
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      writeFile(
        path.join(tmp.path, "notes", `${name(index)}.md`),
        `---\nupdated_at: ${new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString()}\n---\n# ${name(index)}\n\n${index % 2 ? "Odd body" : "Even-needle body"}`,
      ),
    ),
  )
  // Oldest note and last by name, so it falls outside both the capped result and a name-ordered slice.
  await writeFile(
    path.join(tmp.path, "notes", "zzz-needle.md"),
    "---\nupdated_at: 2025-01-01T00:00:00.000Z\n---\n# Needle\n\nCap-regression-needle",
  )
  const directory = AbsolutePath.make(tmp.path)
  const run = (search: string) =>
    Effect.runPromise(
      KnowledgeNote.list(search).pipe(
        Effect.provide(LocationMutation.locationLayer),
        Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
        Effect.provide(LayerNode.compile(FSUtil.node)),
      ),
    )

  expect((await run("cap-regression-needle")).map((note) => note.title)).toEqual(["Needle"])
  // Matches spread across every glob position must all be found, not only those in the first 500 paths.
  expect(await run("even-needle")).toHaveLength(count / 2)

  const all = await run("")
  expect(all).toHaveLength(500)
  expect(all[0]?.title).toBe(name(count - 1))
  expect(all.at(-1)?.title).toBe(name(count - 500))
  expect(all.map((note) => note.title)).not.toContain("Needle")
})

const provideNoteServices =
  (directory: AbsolutePath) =>
  <A, E>(
    effect: Effect.Effect<A, E, Location.Service | LocationMutation.Service | FSUtil.Service | FileMutation.Service>,
  ) =>
    effect.pipe(
      Effect.provide(LocationMutation.locationLayer),
      Effect.provideService(Location.Service, { directory, project: { id: ProjectV2.ID.global, directory } }),
      Effect.provide(LayerNode.compile(FSUtil.node)),
      Effect.provide(LayerNode.compile(FileMutation.node)),
    )

test("a note with a UTF-8 BOM saves against its read revision and keeps the BOM", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "notes"))
  const file = path.join(tmp.path, "notes", "bom.md")
  await writeFile(file, "﻿---\ntitle: Bom\n---\nBefore\n")
  const directory = AbsolutePath.make(tmp.path)
  const read = await Effect.runPromise(KnowledgeNote.read("notes/bom.md").pipe(provideNoteServices(directory)))
  const saved = await Effect.runPromise(
    KnowledgeNote.write("notes/bom.md", { body: "After\n", expectedRevision: read.revision }).pipe(
      provideNoteServices(directory),
    ),
  )
  expect(saved.body).toBe("After\n")
  const bytes = await readFile(file)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(bytes.subarray(3).toString("utf8")).not.toContain("﻿")
  expect(bytes.toString("utf8")).toContain("After")
})

test("list skips malformed notes and folders outside managed Projects", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "notes"))
  await mkdir(path.join(tmp.path, "projects", "scratch", "notes"), { recursive: true })
  await writeFile(path.join(tmp.path, "notes", "good.md"), "# Good\n\nReadable")
  await writeFile(path.join(tmp.path, "notes", "broken.md"), "---\ntitle: [unclosed\n---\nBroken")
  await writeFile(path.join(tmp.path, "projects", "scratch", "notes", "stray.md"), "# Stray\n")
  const found = await Effect.runPromise(KnowledgeNote.list().pipe(provideNoteServices(AbsolutePath.make(tmp.path))))
  expect(found.map((note) => note.path)).toEqual(["notes/good.md"])
})

test("list includes project notes in the .tenon card folder and the legacy one", async () => {
  await using tmp = await tmpdir()
  const current = path.join(tmp.path, ".tenon", "projects", "project_01NEW", "notes")
  const legacy = path.join(tmp.path, "projects", "project_01OLD", "notes")
  await mkdir(current, { recursive: true })
  await mkdir(legacy, { recursive: true })
  await writeFile(path.join(current, "plan.md"), "# Plan\n")
  await writeFile(path.join(legacy, "old.md"), "# Old\n")
  const found = await Effect.runPromise(KnowledgeNote.list().pipe(provideNoteServices(AbsolutePath.make(tmp.path))))
  expect(found.map((note) => note.path).toSorted()).toEqual([
    ".tenon/projects/project_01NEW/notes/plan.md",
    "projects/project_01OLD/notes/old.md",
  ])
  const read = await Effect.runPromise(
    KnowledgeNote.read(".tenon/projects/project_01NEW/notes/plan.md").pipe(
      provideNoteServices(AbsolutePath.make(tmp.path)),
    ),
  )
  expect(read.info.title).toBe("Plan")
})

test("a ---js front matter block is rejected without evaluating it", () => {
  const scope = globalThis as { __pwn?: number }
  expect(() => KnowledgeNote.decode("notes/evil.md", "---js\nglobalThis.__pwn=1\n---\n# Evil\n")).toThrow()
  expect(() =>
    KnowledgeNote.decode("notes/evil.md", "---javascript\n{ title: (globalThis.__pwn = 1) }\n---\n"),
  ).toThrow()
  expect(scope.__pwn).toBeUndefined()
})

test("front matter above the size cap is rejected before parsing", () => {
  expect(() => KnowledgeNote.decode("notes/big.md", `---\ntitle: ${"x".repeat(70 * 1024)}\n---\nBody`)).toThrow()
})

test("hand-written tags decode leniently and round-trip unchanged", () => {
  const numbers = KnowledgeNote.decode("notes/a.md", "---\ntags: [2024, q3]\n---\n# A\n")
  expect(numbers.info.tags).toEqual(["2024", "q3"])
  const scalar = KnowledgeNote.decode("notes/b.md", "---\ntags: work, home\n---\n# B\n")
  expect(scalar.info.tags).toEqual(["work", "home"])
  expect(KnowledgeNote.decode("notes/c.md", "---\ntags: [Work, work]\n---\n# C\n").info.tags).toEqual(["Work"])
  expect(KnowledgeNote.decode("notes/d.md", `---\ntitle: ${"t".repeat(300)}\n---\n`).info.title).toHaveLength(200)

  const savedNumbers = KnowledgeNote.encode(numbers.info, numbers.data, numbers.body)
  expect(savedNumbers).toContain("- 2024\n")
  expect(KnowledgeNote.decode("notes/a.md", savedNumbers).info.tags).toEqual(["2024", "q3"])
  const savedScalar = KnowledgeNote.encode(scalar.info, scalar.data, scalar.body)
  expect(savedScalar).toContain("tags: work, home")
  // A changed tag list is written as a list.
  expect(KnowledgeNote.encode({ ...scalar.info, tags: ["work"] }, scalar.data, scalar.body)).toContain("- work")
})

test("list skips a note above the size cap", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "notes"))
  await writeFile(path.join(tmp.path, "notes", "small.md"), "# Small\n")
  // Sparse, so the test does not write 6 MiB.
  const handle = await open(path.join(tmp.path, "notes", "huge.md"), "w")
  await handle.truncate(6 * 1024 * 1024)
  await handle.close()
  const found = await Effect.runPromise(KnowledgeNote.list().pipe(provideNoteServices(AbsolutePath.make(tmp.path))))
  expect(found.map((note) => note.path)).toEqual(["notes/small.md"])
})

test("the unfiltered list re-reads only notes whose size or time changed", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "notes"))
  const first = path.join(tmp.path, "notes", "first.md")
  const second = path.join(tmp.path, "notes", "second.md")
  await writeFile(first, "# First\n")
  await writeFile(second, "# Second\n")
  const run = () => Effect.runPromise(KnowledgeNote.list().pipe(provideNoteServices(AbsolutePath.make(tmp.path))))
  await run()
  // Same size and time: the cached summary is reused, so the new title is not read.
  const firstTime = (await stat(first)).mtime
  await writeFile(first, "# Fixed\n")
  await utimes(first, firstTime, firstTime)
  // A real edit changes the time and is read again.
  const later = new Date(Date.now() + 5_000)
  await writeFile(second, "# Changed title\n")
  await utimes(second, later, later)
  expect((await run()).map((note) => note.title).toSorted()).toEqual(["Changed title", "First"])
})
