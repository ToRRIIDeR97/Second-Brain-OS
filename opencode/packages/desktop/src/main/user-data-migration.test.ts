import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  type PathLike,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { marker, migrateUserData } from "./user-data-migration"

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function setup(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "user-data-migration-"))
  roots.push(root)
  const from = join(root, "ai.opencode.desktop.dev")
  Object.entries(files).forEach(([file, content]) => {
    mkdirSync(dirname(join(from, file)), { recursive: true })
    writeFileSync(join(from, file), content)
  })
  return { root, from, to: join(root, "io.github.torriider97.tenonworkbench.dev") }
}

function list(dir: string) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .toSorted()
}

describe("migrateUserData", () => {
  test("copies stores and state, skips caches and locks, and leaves the old folder unchanged", () => {
    const dirs = setup({
      "opencode.settings": "{}",
      "drafts.sqlite": "db",
      "Local Storage/leveldb/000003.log": "ls",
      "tenon-workbench/model.json": "{}",
      "Cache/Cache_Data/data_0": "x",
      "Code Cache/js/index": "x",
      "cli/1.0.0/opencode-cli.exe": "x",
      "logs/main.log": "x",
      SingletonLock: "x",
    })
    const before = list(dirs.from)

    expect(migrateUserData(dirs.from, dirs.to)).toBe("copied")

    expect(list(dirs.to)).toEqual([
      marker,
      "Local Storage/leveldb/000003.log",
      "drafts.sqlite",
      "opencode.settings",
      "tenon-workbench/model.json",
    ])
    expect(list(dirs.from)).toEqual(before)
    expect(readdirSync(dirs.root).toSorted()).toEqual([
      "ai.opencode.desktop.dev",
      "io.github.torriider97.tenonworkbench.dev",
    ])
  })

  test("runs once and keeps files the new folder already has", () => {
    const dirs = setup({ "opencode.settings": "old", "default.dat": "old" })
    mkdirSync(dirs.to)
    writeFileSync(join(dirs.to, "opencode.settings"), "new")

    expect(migrateUserData(dirs.from, dirs.to)).toBe("copied")
    expect(readFileSync(join(dirs.to, "opencode.settings"), "utf8")).toBe("new")
    expect(readFileSync(join(dirs.to, "default.dat"), "utf8")).toBe("old")

    writeFileSync(join(dirs.from, "late.dat"), "{}")
    expect(migrateUserData(dirs.from, dirs.to)).toBe("done")
    expect(existsSync(join(dirs.to, "late.dat"))).toBe(false)
  })

  test("keeps the copy and retries on the next start when an entry cannot be moved", () => {
    const dirs = setup({ "opencode.settings": "old", "storage/default.dat": "old" })
    // The single-instance lock creates the new folder before the copy runs.
    mkdirSync(dirs.to)
    writeFileSync(join(dirs.to, "SingletonLock"), "x")
    const failing = (from: PathLike, to: PathLike) => {
      if (String(from).endsWith("storage")) throw new Error("EBUSY")
      renameSync(from, to)
    }

    expect(() => migrateUserData(dirs.from, dirs.to, failing)).toThrow("could not move storage into")
    expect(existsSync(join(dirs.to, marker))).toBe(false)
    expect(readdirSync(dirs.root).filter((name) => name.includes(".migrating-"))).toHaveLength(1)

    expect(migrateUserData(dirs.from, dirs.to)).toBe("copied")
    expect(readFileSync(join(dirs.to, "storage/default.dat"), "utf8")).toBe("old")
    expect(existsSync(join(dirs.to, marker))).toBe(true)
  })

  test("beta and prod pass no old folder and start fresh", () => {
    const dirs = setup({ "opencode.settings": "upstream" })

    expect(migrateUserData(undefined, dirs.to)).toBe("absent")
    expect(list(dirs.to)).toEqual([marker])
    expect(migrateUserData(dirs.from, dirs.to)).toBe("done")
  })
})
