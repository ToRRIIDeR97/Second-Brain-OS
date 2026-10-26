import { describe, expect, test } from "bun:test"
import { isBuiltInSkill, skillSections } from "./skills-sections"

describe("isBuiltInSkill", () => {
  const sections = skillSections({
    tenon: [{ name: "customize-opencode", scope: "global" }],
    harnesses: [{ id: "gem", name: "Custom Agent", source: "reported", skills: [{ name: "review", scope: "global" }] }],
  })

  test("a Tenon skill without a location is built-in", () => {
    expect(isBuiltInSkill(sections[0].skills[0], sections[0].editable)).toBe(true)
  })

  test("a reported harness command is not built-in", () => {
    expect(isBuiltInSkill(sections[1].skills[0], sections[1].editable)).toBe(false)
  })

  test("a Tenon skill with a file is not built-in", () => {
    expect(isBuiltInSkill({ name: "notes", location: "/t/notes/SKILL.md", scope: "global" }, true)).toBe(false)
  })
})
