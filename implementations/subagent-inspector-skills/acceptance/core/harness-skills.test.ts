import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { HarnessSkills } from "../../../../opencode/packages/core/src/harness/skills"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-skills-"))
const home = path.join(root, "home")
const project = path.join(root, "project")
afterAll(() => fs.rm(root, { recursive: true, force: true }))

async function skill(dir: string, name: string, frontmatter: string) {
  await fs.mkdir(path.join(dir, name), { recursive: true })
  await fs.writeFile(path.join(dir, name, "SKILL.md"), `---\n${frontmatter}\n---\nBody of ${name}\n`)
}

await skill(path.join(home, ".codex/skills"), "handover", "name: handover\ndescription: Write a handover")
await skill(path.join(home, ".claude/skills"), "unslop", "name: unslop\ndescription: Strip AI patterns")
await skill(path.join(project, ".claude/skills"), "deploy", "name: deploy\ndescription: Ship it")

const scan = (harness: HarnessSkills.Harness, reported?: HarnessSkills.Reported) =>
  Effect.runPromise(HarnessSkills.scan({ home, directory: project, harness, reported }))

describe("AC-9 / AC-10 harness skill discovery", () => {
  test("AC-10 Codex reads its global skills folder", async () => {
    const result = await scan({ id: "codex", driver: "codex" })
    expect(result.source).toBe("filesystem")
    expect(result.skills).toEqual([
      {
        name: "handover",
        description: "Write a handover",
        location: path.join(home, ".codex/skills/handover/SKILL.md"),
        scope: "global",
      },
    ])
  })

  test("AC-10 a Claude ACP harness reads global then project .claude skills", async () => {
    const result = await scan({ id: "claude", driver: "acp", command: "/usr/local/bin/claude-code-acp" })
    expect(result.source).toBe("filesystem")
    expect(result.skills.map((item) => [item.name, item.scope])).toEqual([
      ["unslop", "global"],
      ["deploy", "project"],
    ])
  })

  test("AC-9 skill content is not returned", async () => {
    const result = await scan({ id: "codex", driver: "codex" })
    expect(JSON.stringify(result)).not.toContain("Body of")
  })

  test("AC-10 an unknown ACP harness uses the commands it reported", async () => {
    const result = await scan({ id: "gem", driver: "acp", command: "gemini" }, [{ name: "review", description: "Review" }])
    expect(result).toEqual({ source: "reported", skills: [{ name: "review", description: "Review", scope: "global" }] })
  })

  test("AC-10 an unknown ACP harness with no report has no skills", async () => {
    expect(await scan({ id: "gem", driver: "acp", command: "gemini" })).toEqual({ source: "none", skills: [] })
  })
})
