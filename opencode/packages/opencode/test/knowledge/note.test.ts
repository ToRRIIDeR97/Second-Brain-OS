import { describe, expect, test } from "bun:test"
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
