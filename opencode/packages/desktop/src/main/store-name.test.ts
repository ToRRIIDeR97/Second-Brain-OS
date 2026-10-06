import { describe, expect, test } from "bun:test"
import { assertStoreName, isValidStoreName } from "./store-name"

describe("store name validation", () => {
  test("accepts the store names the renderer and migration use", () => {
    expect(isValidStoreName("opencode.settings")).toBe(true)
    expect(isValidStoreName("default.dat")).toBe(true)
    expect(isValidStoreName("opencode.global.dat")).toBe(true)
    expect(isValidStoreName("opencode.workspace.C_-Users-foo-123456")).toBe(true)
  })

  test("rejects names that escape userData or hide files", () => {
    expect(isValidStoreName("")).toBe(false)
    expect(isValidStoreName("..")).toBe(false)
    expect(isValidStoreName(".hidden")).toBe(false)
    expect(isValidStoreName("../evil")).toBe(false)
    expect(isValidStoreName("a/b")).toBe(false)
    expect(isValidStoreName("a\\b")).toBe(false)
    expect(isValidStoreName("C:evil")).toBe(false)
    expect(isValidStoreName("a b")).toBe(false)
  })

  test("assertStoreName throws without echoing the name", () => {
    expect(() => assertStoreName("../evil")).toThrow("Invalid store name")
  })
})