import { expect, test } from "bun:test"
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { saveSessionExport } from "./session-export"

test("export cancel returns false; completed save writes JSON before success", async () => {
  expect(await saveSessionExport({ filename: "run.json", json: "{}" }, async () => null)).toBe(false)
  const directory = await mkdtemp(join(tmpdir(), "session-export-"))
  const file = join(directory, "run.json")
  try {
    expect(await saveSessionExport({ filename: "run.json", json: '{"messages":["context"]}' }, async () => file)).toBe(
      true,
    )
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ messages: ["context"] })
  } finally {
    await unlink(file)
    await rmdir(directory)
  }
})
test("rejects renderer paths and invalid JSON before opening a dialog", async () => {
  let chosen = false
  const choose = async () => {
    chosen = true
    return null
  }
  await expect(saveSessionExport({ filename: "../run.json", json: "{}" }, choose)).rejects.toThrow()
  await expect(saveSessionExport({ filename: "run.json", json: "invalid" }, choose)).rejects.toThrow()
  expect(chosen).toBe(false)
})
