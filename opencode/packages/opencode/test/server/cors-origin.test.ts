import { describe, expect, test } from "bun:test"
import { isAllowedCorsOrigin } from "@opencode-ai/server/cors"

describe("isAllowedCorsOrigin", () => {
  test("allows local development, the desktop renderer and configured origins", () => {
    expect(isAllowedCorsOrigin(undefined)).toBe(true)
    expect(isAllowedCorsOrigin("http://localhost:3000")).toBe(true)
    expect(isAllowedCorsOrigin("http://127.0.0.1:4096")).toBe(true)
    expect(isAllowedCorsOrigin("oc://renderer")).toBe(true)
    expect(isAllowedCorsOrigin("https://custom.example", { cors: ["https://custom.example"] })).toBe(true)
  })

  test("rejects hosted, Tauri and look-alike origins", () => {
    for (const origin of [
      "https://app.opencode.ai",
      "https://opencode.ai",
      "tauri://localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
      "oc://renderer.evil.example",
      "oc://rendererx",
      "http://localhost:3000.evil.example",
      "https://evil.example",
    ])
      expect(isAllowedCorsOrigin(origin)).toBe(false)
  })
})
