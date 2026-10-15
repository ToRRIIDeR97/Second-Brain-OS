import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { LegacyStorage } from "../src/legacy-storage"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function tree(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-storage-"))
  roots.push(root)
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await fs.mkdir(path.dirname(path.join(root, "opencode", file)), { recursive: true })
      await fs.writeFile(path.join(root, "opencode", file), content)
    }),
  )
  return { from: path.join(root, "opencode"), to: path.join(root, "tenon-workbench"), root }
}

async function list(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .toSorted()
}

describe("LegacyStorage.migrate", () => {
  test("copies owned files, skips caches and temp files, and leaves the legacy folder unchanged", async () => {
    const dirs = await tree({
      "auth.json": "{}",
      "opencode-local.db": "db",
      "opencode-local.db-wal": "wal",
      "plans/a.md": "plan",
      "snapshot/project/HEAD": "ref",
      "worktree/project/file": "x",
      "harnesses.json.tmp": "partial",
    })
    const before = await list(dirs.from)

    expect(await LegacyStorage.migrate([{ ...dirs, skip: ["snapshot", "worktree"] }])).toEqual(["copied"])

    expect(await list(dirs.to)).toEqual([
      LegacyStorage.marker,
      "auth.json",
      "opencode-local.db",
      "opencode-local.db-wal",
      "plans/a.md",
    ])
    expect(await list(dirs.from)).toEqual(before)
    expect((await fs.readdir(dirs.root)).toSorted()).toEqual(["opencode", "tenon-workbench"])
  })

  test("runs once: after the marker is written, legacy changes are ignored", async () => {
    const dirs = await tree({ "auth.json": "legacy" })
    const root = { ...dirs, skip: [] }
    expect(await LegacyStorage.migrate([root])).toEqual(["copied"])
    await fs.writeFile(path.join(dirs.from, "late.json"), "{}")

    expect(await LegacyStorage.migrate([root])).toEqual(["done"])
    expect(await list(dirs.to)).toEqual([LegacyStorage.marker, "auth.json"])
  })

  test("merges into a target that early startup already created, keeping its files", async () => {
    const dirs = await tree({ "auth.json": "legacy", "opencode.db": "db", "log/old.log": "x" })
    await fs.mkdir(path.join(dirs.to, "log"), { recursive: true })
    await fs.writeFile(path.join(dirs.to, "auth.json"), "current")

    expect(await LegacyStorage.migrate([{ ...dirs, skip: ["log"] }])).toEqual(["copied"])
    expect(await list(dirs.to)).toEqual([LegacyStorage.marker, "auth.json", "opencode.db"])
    expect(await fs.readFile(path.join(dirs.to, "auth.json"), "utf8")).toBe("current")
    expect((await fs.readdir(dirs.root)).toSorted()).toEqual(["opencode", "tenon-workbench"])
  })

  test("marks a fresh install so a later upstream install is never imported", async () => {
    const dirs = await tree({})
    await fs.rm(dirs.from, { recursive: true, force: true })
    const root = { ...dirs, skip: [] }

    expect(await LegacyStorage.migrate([root])).toEqual(["absent"])
    await fs.mkdir(dirs.from)
    await fs.writeFile(path.join(dirs.from, "auth.json"), "upstream")
    expect(await LegacyStorage.migrate([root])).toEqual(["done"])
    expect(await list(dirs.to)).toEqual([LegacyStorage.marker])
  })

  test("copies the contents of a symlinked legacy root, not the link", async () => {
    const dirs = await tree({ "auth.json": "{}" })
    const link = path.join(dirs.root, "linked")
    await fs.symlink(dirs.from, link, "junction")

    expect(await LegacyStorage.migrate([{ from: link, to: dirs.to, skip: [] }])).toEqual(["copied"])
    expect((await fs.lstat(dirs.to)).isSymbolicLink()).toBe(false)
    await fs.writeFile(path.join(dirs.to, "auth.json"), "changed")
    expect(await fs.readFile(path.join(dirs.from, "auth.json"), "utf8")).toBe("{}")
  })

  test("concurrent migrations produce one complete copy", async () => {
    const dirs = await tree({ "auth.json": "{}", "storage/session/a.json": "{}" })
    const root = { ...dirs, skip: [] }

    const results = await Promise.all([LegacyStorage.migrate([root]), LegacyStorage.migrate([root])])

    expect(results.flat()).toEqual(["copied", "copied"])
    expect(await list(dirs.to)).toEqual([LegacyStorage.marker, "auth.json", "storage/session/a.json"])
    expect((await fs.readdir(dirs.root)).toSorted()).toEqual(["opencode", "tenon-workbench"])
  })
})
