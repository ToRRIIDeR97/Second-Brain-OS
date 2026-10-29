import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { persistedHarnessKey } from "./harness-controller"

const sidecar = (url: string): ServerConnection.Any => ({ type: "sidecar", variant: "base", http: { url } })

describe("persistedHarnessKey", () => {
  test("reuses the persisted list when the desktop sidecar restarts on another port", () => {
    expect(persistedHarnessKey(sidecar("http://127.0.0.1:50251"), "C:\\brain")).toBe(
      persistedHarnessKey(sidecar("http://127.0.0.1:63285"), "C:\\brain"),
    )
    expect(persistedHarnessKey(sidecar("http://127.0.0.1:50251"), "C:\\brain")).not.toBe(
      persistedHarnessKey(sidecar("http://127.0.0.1:50251"), "C:\\other"),
    )
  })

  test("keeps remote servers apart by their URL", () => {
    const remote = (url: string): ServerConnection.Any => ({ type: "http", http: { url } })
    expect(persistedHarnessKey(remote("https://a.example"), "/repo")).not.toBe(
      persistedHarnessKey(remote("https://b.example"), "/repo"),
    )
  })
})
