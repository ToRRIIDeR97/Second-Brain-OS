import { describe, expect, test } from "bun:test"
import { assertStoreName, isValidStoreName } from "./store-name"

describe("store name validation", () => {
  test("accepts the store names the renderer uses", () => {
    expect(isValidStoreName("default.dat")).toBe(true)
    expect(isValidStoreName("opencode.global.dat")).toBe(true)
    expect(isValidStoreName("opencode.window.win-1.dat")).toBe(true)
    expect(isValidStoreName("opencode.workspace.C_-Users-foo.1a2b3c.dat")).toBe(true)
    expect(isValidStoreName("opencode.draft.draft-1.42.dat")).toBe(true)
  })

  test("rejects main-owned store files", () => {
    expect(isValidStoreName("opencode.settings")).toBe(false)
    expect(isValidStoreName("opencode.updater")).toBe(false)
    expect(isValidStoreName("second-brain.google")).toBe(false)
    expect(isValidStoreName("window-state.json")).toBe(false)
    expect(isValidStoreName("Preferences")).toBe(false)
    expect(isValidStoreName("Local State")).toBe(false)
  })

  test("rejects names that escape userData or hide files", () => {
    expect(isValidStoreName("")).toBe(false)
    expect(isValidStoreName("..")).toBe(false)
    expect(isValidStoreName(".hidden.dat")).toBe(false)
    expect(isValidStoreName("opencode..dat")).toBe(false)
    expect(isValidStoreName("../opencode.global.dat")).toBe(false)
    expect(isValidStoreName("opencode.a/b.dat")).toBe(false)
    expect(isValidStoreName("opencode.a\\b.dat")).toBe(false)
    expect(isValidStoreName("C:opencode.global.dat")).toBe(false)
    expect(isValidStoreName("opencode.a b.dat")).toBe(false)
    expect(isValidStoreName(42)).toBe(false)
  })

  test("assertStoreName throws without echoing the name", () => {
    expect(() => assertStoreName("../evil")).toThrow("Invalid store name")
  })
})
