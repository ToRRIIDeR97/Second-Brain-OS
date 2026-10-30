import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { configuredInstances, settingsEntries } from "../../../../opencode/packages/core/src/harness"
import { ConfigHarness } from "../../../../opencode/packages/core/src/config/harness"
import type { Config } from "../../../../opencode/packages/core/src/config"

const entry = Schema.decodeUnknownSync(ConfigHarness.Instance)
const doc = (path: string, id: string) =>
  ({
    type: "document",
    path,
    info: { harnesses: { [id]: entry({ driver: "acp", name: id, config: { command: `/tmp/${id}` } }) } },
  }) as unknown as Config.Entry

describe("AC-6 harnesses come only from global config", () => {
  const global = "/home/me/.config/tenon-workbench"
  const entries = [doc(`${global}/opencode.json`, "mine"), doc("/home/me/repo/opencode.json", "from-repo")]

  test("a project config's harness is not an instance", () => {
    const ids = configuredInstances(entries, {}, global).map((instance) => instance.id)
    expect(ids).toContain("mine")
    expect(ids).not.toContain("from-repo")
  })

  test("Settings does not list it either", () => {
    const ids = settingsEntries(entries, {}, global).map((item) => item.id)
    expect(ids).not.toContain("from-repo")
  })
})
