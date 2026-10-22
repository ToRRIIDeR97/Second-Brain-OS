import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { HarnessSkills } from "../../../../opencode/packages/core/src/harness/skills"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-skills-verify-"))
const home = path.join(root, "home")
const project = path.join(root, "project")
const empty = path.join(root, "empty-home")
afterAll(() => fs.rm(root, { recursive: true, force: true }))

async function write(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
}

await write(path.join(home, ".config/opencode/skills/oc-global/SKILL.md"), "---\nname: oc-global\n---\nx")
await write(path.join(home, ".agents/skills/shared/SKILL.md"), "---\ndescription: Shared skill\n---\nx")
await write(path.join(home, ".agents/skills/notes.md"), "---\nname: not-a-skill\n---\nx")
await write(path.join(project, ".opencode/skill/group/nested/SKILL.md"), "---\nname: nested\n---\nx")
await write(path.join(project, ".codex/skills/proj-codex/SKILL.md"), "---\nname: proj-codex\n---\nx")

const scan = (input: { home?: string; harness: HarnessSkills.Harness; reported?: HarnessSkills.Reported }) =>
  Effect.runPromise(
    HarnessSkills.scan({ home: input.home ?? home, directory: project, harness: input.harness, reported: input.reported }),
  )

describe("verify AC-9 / AC-10 harness skill discovery", () => {
  test("AC-10 OpenCode ACP reads its own, Claude and agents folders, global then project", async () => {
    const result = await scan({ harness: { id: "opencode-acp", driver: "acp", command: "opencode" } })
    expect(result.source).toBe("filesystem")
    expect(result.skills.map((item) => [item.name, item.scope])).toEqual([
      ["oc-global", "global"],
      ["shared", "global"],
      ["nested", "project"],
    ])
  })

  test("AC-10 a skill without a name uses its folder name and keeps its description", async () => {
    const result = await scan({ harness: { id: "opencode-acp", driver: "acp", command: "opencode" } })
    expect(result.skills.find((item) => item.name === "shared")).toMatchObject({ description: "Shared skill" })
  })

  test("AC-10 loose markdown files are not skills", async () => {
    const result = await scan({ harness: { id: "opencode-acp", driver: "acp", command: "opencode" } })
    expect(result.skills.map((item) => item.name)).not.toContain("not-a-skill")
  })

  test("AC-10 Codex project skills are marked project", async () => {
    const result = await scan({ home: empty, harness: { id: "codex", driver: "codex" } })
    expect(result).toEqual({
      source: "filesystem",
      skills: [
        { name: "proj-codex", location: path.join(project, ".codex/skills/proj-codex/SKILL.md"), scope: "project" },
      ],
    })
  })

  test("AC-10 missing folders give an empty list, not an error", async () => {
    const result = await scan({ home: empty, harness: { id: "claude", driver: "acp", command: "C:\\Tools\\Claude.EXE" } })
    expect(result).toEqual({ source: "filesystem", skills: [] })
  })

  test("AC-9 the in-process Tenon agent is not a harness skill source", async () => {
    expect(await scan({ harness: { id: "opencode", driver: "opencode" } })).toEqual({ source: "none", skills: [] })
  })
})
