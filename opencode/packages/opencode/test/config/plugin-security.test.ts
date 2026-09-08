import { describe, expect, test } from "bun:test"
import { ConfigPlugin } from "@/config/plugin"

describe("plugin execution policy", () => {
  test("blocks local plugins in the desktop host", () => {
    expect(ConfigPlugin.allowsCode("local", "desktop")).toBe(false)
    expect(ConfigPlugin.allowsCode("global", "desktop")).toBe(true)
    expect(ConfigPlugin.allowsCode("local", "cli")).toBe(true)
  })
})
