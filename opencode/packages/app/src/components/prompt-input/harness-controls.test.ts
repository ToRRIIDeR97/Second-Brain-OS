import { describe, expect, test } from "bun:test"
import { harnessModelSlot } from "./harness-controls"

describe("harnessModelSlot", () => {
  test("shows the picker whenever the harness reports models", () => {
    expect(harnessModelSlot({ models: 2, checking: true })).toBe("select")
    expect(harnessModelSlot({ models: 1, checking: false })).toBe("select")
  })

  test("shows a loading label while a check is still running", () => {
    expect(harnessModelSlot({ models: 0, checking: true })).toBe("loading")
  })

  test("reports no models only once checking has finished", () => {
    expect(harnessModelSlot({ models: 0, checking: false })).toBe("none")
  })
})
