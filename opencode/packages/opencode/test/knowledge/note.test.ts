import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
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
