import { describe, expect, test } from "bun:test"
import { assertAllowedApp } from "./apps"
import { assertRendererStoreName } from "./store-name"

describe("desktop renderer boundaries", () => {
  test("allows product-owned stores and known applications", () => {
    expect(assertRendererStoreName("default.dat")).toBe("default.dat")
    expect(assertRendererStoreName("opencode.global.dat")).toBe("opencode.global.dat")
    expect(assertRendererStoreName("opencode.workspace.repo.123.dat")).toBe("opencode.workspace.repo.123.dat")
    expect(assertAllowedApp("Visual Studio Code")).toBe("Visual Studio Code")
  })

  test("rejects paths and native-only store names", () => {
    expect(() => assertRendererStoreName("../outside.json")).toThrow("Invalid renderer store name")
    expect(() => assertRendererStoreName("second-brain.google")).toThrow("Invalid renderer store name")
    expect(() => assertAllowedApp("/tmp/attacker")).toThrow("Invalid application")
  })
})
