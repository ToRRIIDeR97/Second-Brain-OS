import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AcpHarness } from "@opencode-ai/core/harness/acp"
import { HarnessSkills } from "@opencode-ai/core/harness/skills"
import { SkillV2 } from "@opencode-ai/core/skill"
import { AbsolutePath } from "@opencode-ai/core/schema"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-skills-core-"))
const home = path.join(root, "home")
const project = path.join(root, "project")
afterAll(() => fs.rm(root, { recursive: true, force: true }))

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

await write(path.join(home, ".config/opencode/skills/b-skill/SKILL.md"), "---\nname: beta\n---\nBody\n")
await write(path.join(home, ".config/opencode/skill/a-skill/SKILL.md"), "---\ndescription: No name here\n---\nBody\n")
await write(path.join(home, ".agents/skills/nested/deep/SKILL.md"), "---\nname: deep\n---\nBody\n")
await write(path.join(project, ".opencode/skills/local/SKILL.md"), "---\nname: local\n---\nBody\n")
await write(path.join(project, ".opencode/skills/notes.md"), "---\nname: loose\n---\nNot a skill\n")
await write(path.join(project, ".claude/skills/broken/SKILL.md"), "---\nname: [unclosed\n---\nBody\n")

const scan = (harness: HarnessSkills.Harness, reported?: HarnessSkills.Reported, directory = project) =>
  Effect.runPromise(HarnessSkills.scan({ home, directory, harness, reported }))

describe("HarnessSkills.scan", () => {
  test("an OpenCode ACP harness reads its folders, global first, each sorted by path", async () => {
    const result = await scan({ id: "opencode-acp", driver: "acp", command: "opencode" })
    expect(result.source).toBe("filesystem")
    expect(result.skills.map((item) => [item.name, item.scope])).toEqual([
      ["beta", "global"],
      ["a-skill", "global"],
      ["deep", "global"],
      ["local", "project"],
      ["broken", "project"],
    ])
    expect(result.skills.find((item) => item.name === "a-skill")).toMatchObject({ description: "No name here" })
    expect(result.skills.some((item) => item.name === "loose")).toBe(false)
  })

  test("project folders are read from the working directory up to the repository root", async () => {
    const repo = path.join(root, "repo")
    const nested = path.join(repo, "packages/app")
    await fs.mkdir(path.join(repo, ".git"), { recursive: true })
    await write(path.join(repo, ".agents/skills/root-skill/SKILL.md"), "---\nname: root-skill\n---\nBody\n")
    await write(path.join(nested, ".agents/skills/app-skill/SKILL.md"), "---\nname: app-skill\n---\nBody\n")
    // Above the repository root: not part of the project.
    await write(path.join(root, ".agents/skills/outside/SKILL.md"), "---\nname: outside\n---\nBody\n")
    const empty = path.join(root, "empty-home")
    const result = await Effect.runPromise(
      HarnessSkills.scan({ home: empty, directory: nested, harness: { id: "codex", driver: "codex" } }),
    )
    expect(result.skills.map((item) => [item.name, item.scope])).toEqual([
      ["app-skill", "project"],
      ["root-skill", "project"],
    ])
  })

  test("Codex reads ~/.agents/skills and ~/.codex/skills but no project .codex/skills", async () => {
    const codexHome = path.join(root, "codex-home")
    const codexProject = path.join(root, "codex-project")
    await write(path.join(codexHome, ".agents/skills/user/SKILL.md"), "---\nname: user\n---\nBody\n")
    await write(path.join(codexHome, ".codex/skills/.system/plan/SKILL.md"), "---\nname: plan\n---\nBody\n")
    await write(path.join(codexProject, ".codex/skills/old/SKILL.md"), "---\nname: old\n---\nBody\n")
    const result = await Effect.runPromise(
      HarnessSkills.scan({ home: codexHome, directory: codexProject, harness: { id: "codex", driver: "codex" } }),
    )
    expect(result.skills.map((item) => item.name)).toEqual(["user", "plan"])
  })

  test("recognizes a Claude command by its file name in any path style", async () => {
    for (const command of ["C:\\Tools\\Claude.EXE", "/opt/bin/claude", "claude-code-acp.js"]) {
      const result = await scan({ id: "claude", driver: "acp", command })
      expect(result.source).toBe("filesystem")
    }
  })

  test("known folders that don't exist give an empty filesystem result", async () => {
    const missing = path.join(root, "missing")
    const result = await Effect.runPromise(
      HarnessSkills.scan({ home: missing, directory: missing, harness: { id: "codex", driver: "codex" } }),
    )
    expect(result).toEqual({ source: "filesystem", skills: [] })
  })

  test("lists a file once when the project is the home directory", async () => {
    const result = await scan({ id: "opencode-acp", driver: "acp", command: "opencode" }, undefined, home)
    const locations = result.skills.map((item) => item.location)
    expect(new Set(locations).size).toBe(locations.length)
    expect(result.skills.every((item) => item.scope === "global")).toBe(true)
  })

  test("the in-process agent and drivers without folders have no harness skills", async () => {
    expect(await scan({ id: "opencode", driver: "opencode" }, [{ name: "x" }])).toEqual({ source: "none", skills: [] })
    expect(await scan({ id: "gem", driver: "acp", command: "custom-agent" }, [])).toEqual({
      source: "none",
      skills: [],
    })
  })
})

describe("AcpHarness.reportedCommands", () => {
  test("reads commands from available_commands_update only", () => {
    const update = (value: Record<string, unknown>) => ({
      method: "session/update",
      params: { sessionId: "s", update: value },
    })
    expect(
      AcpHarness.reportedCommands(
        update({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "init", input: null }, {}] }),
      ),
    ).toEqual([{ name: "init" }])
    expect(AcpHarness.reportedCommands(update({ sessionUpdate: "agent_message_chunk" }))).toBeUndefined()
  })
})

describe("HarnessSkills.tenonSkills", () => {
  test("omits the location of embedded skills and keeps file-based ones", () => {
    const builtIn = {
      name: "customize-opencode",
      description: "Customize",
      location: AbsolutePath.make("/builtin/customize-opencode.md"),
      content: "Body",
    }
    const file = { name: "notes", location: AbsolutePath.make("/t/notes/SKILL.md"), content: "Body" }
    const result = HarnessSkills.tenonSkills(
      [builtIn, file],
      [
        SkillV2.EmbeddedSource.make({ type: "embedded", skill: builtIn }),
        SkillV2.DirectorySource.make({ type: "directory", path: AbsolutePath.make("/t") }),
      ],
    )
    expect(result).toEqual([
      { name: "customize-opencode", description: "Customize", scope: "global", enabled: true },
      { name: "notes", location: "/t/notes/SKILL.md", scope: "global", enabled: true },
    ])
    expect(JSON.stringify(result)).not.toContain("Body")
  })

  test("a file skill that replaces an embedded one keeps its location", () => {
    const builtIn = { name: "notes", location: AbsolutePath.make("/builtin/notes.md"), content: "Body" }
    const file = { name: "notes", location: AbsolutePath.make("/t/notes/SKILL.md"), content: "Body" }
    const result = HarnessSkills.tenonSkills(
      [file],
      [SkillV2.EmbeddedSource.make({ type: "embedded", skill: builtIn })],
    )
    expect(result).toEqual([{ name: "notes", location: "/t/notes/SKILL.md", scope: "global", enabled: true }])
  })

  test("marks switched-off skills", () => {
    const file = { name: "notes", location: AbsolutePath.make("/t/notes/SKILL.md"), content: "Body" }
    expect(HarnessSkills.tenonSkills([file], [], new Set(["notes"]))).toEqual([
      { name: "notes", location: "/t/notes/SKILL.md", scope: "global", enabled: false },
    ])
  })
})
