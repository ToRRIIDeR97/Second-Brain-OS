import { describe, expect, test } from "bun:test"
import { skillSections } from "../../../../opencode/packages/app/src/components/settings-v2/skills-sections"

const catalog = {
  tenon: [
    { name: "note-linker", location: "/t/note-linker/SKILL.md", scope: "global" as const },
    { name: "Daily-review", description: "Review the day", location: "/t/daily/SKILL.md", scope: "global" as const },
  ],
  harnesses: [
    {
      id: "codex",
      name: "Codex",
      source: "filesystem" as const,
      skills: [{ name: "handover", location: "/h/.codex/skills/handover/SKILL.md", scope: "global" as const }],
    },
    { id: "gem", name: "Gemini", source: "none" as const, skills: [] },
  ],
}

describe("AC-11 skills page sections", () => {
  test("AC-11 Tenon comes first and is the only editable section", () => {
    const sections = skillSections(catalog)
    expect(sections.map((section) => [section.id, section.title, section.editable])).toEqual([
      ["tenon", "Tenon", true],
      ["codex", "Codex", false],
      ["gem", "Gemini", false],
    ])
  })

  test("AC-11 skills are sorted by name, ignoring case", () => {
    expect(skillSections(catalog)[0].skills.map((skill) => skill.name)).toEqual(["Daily-review", "note-linker"])
  })

  test("AC-11 a harness with no skills keeps its section for the empty state", () => {
    expect(skillSections(catalog)[2]).toMatchObject({ id: "gem", source: "none", skills: [] })
  })
})
