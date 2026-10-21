import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { WorkspaceInstructions } from "@opencode-ai/core/workspace-instructions"
import { tmpdir } from "./fixture/tmpdir"

const run = (directory: string, dataDir: string) =>
  Effect.runPromise(
    WorkspaceInstructions.resolve(directory, dataDir).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
  )

const write = async (file: string, content = "") => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

describe("WorkspaceInstructions.resolve", () => {
  test("a project's own AGENTS.md replaces the workspace default", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "Brain")
    const project = path.join(root, "Projects", "Quant")
    await write(path.join(root, WorkspaceInstructions.manifestPath), "{}")
    await write(path.join(root, "AGENTS.md"))
    await write(path.join(project, "AGENTS.md"))
    expect(await run(path.join(project, "src"), tmp.path)).toEqual([path.join(project, "AGENTS.md")])
  })

  test("falls back to the workspace AGENTS.md, including at the root itself", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "Brain")
    await write(path.join(root, WorkspaceInstructions.manifestPath), "{}")
    await write(path.join(root, "AGENTS.md"))
    await fs.mkdir(path.join(root, "projects", "plain"), { recursive: true })
    expect(await run(path.join(root, "projects", "plain"), tmp.path)).toEqual([path.join(root, "AGENTS.md")])
    expect(await run(root, tmp.path)).toEqual([path.join(root, "AGENTS.md")])
  })

  test("a linked folder outside the workspace uses the link index", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "Brain")
    const linked = path.join(tmp.path, "elsewhere", "repo")
    await write(path.join(root, WorkspaceInstructions.manifestPath), "{}")
    await write(path.join(root, "AGENTS.md"))
    await fs.mkdir(linked, { recursive: true })
    await write(path.join(tmp.path, WorkspaceInstructions.linkIndexFile), JSON.stringify({ [linked]: root }))
    expect(await run(linked, tmp.path)).toEqual([path.join(root, "AGENTS.md")])
    await write(path.join(linked, "AGENTS.md"))
    expect(await run(linked, tmp.path)).toEqual([path.join(linked, "AGENTS.md")])
    // An AGENTS.md above the linked folder is not part of the project.
    await write(path.join(tmp.path, "elsewhere", "AGENTS.md"))
    await fs.rm(path.join(linked, "AGENTS.md"))
    expect(await run(linked, tmp.path)).toEqual([path.join(root, "AGENTS.md")])
  })

  test("returns undefined outside any workspace", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "plain"), { recursive: true })
    expect(await run(path.join(tmp.path, "plain"), tmp.path)).toBeUndefined()
  })
})
