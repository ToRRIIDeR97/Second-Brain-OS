import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { focusWhenConnected } from "../src/utils/focus-when-connected"
import { createFreshItems } from "../src/utils/fresh-items"

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

describe("focusWhenConnected", () => {
  test("waits for a view that is attached after it renders", async () => {
    const input = document.createElement("input")
    focusWhenConnected(input)
    await frame()
    expect(document.activeElement).not.toBe(input)
    document.body.append(input)
    await frame()
    await frame()
    expect(document.activeElement).toBe(input)
    input.remove()
  })
})

describe("createFreshItems", () => {
  test("marks only ids that join after the first render", () => {
    const fresh = createRoot((dispose) => {
      const check = createFreshItems()
      expect(check("first")).toBe(false)
      return { check, dispose }
    })
    expect(fresh.check("first")).toBe(false)
    expect(fresh.check("later")).toBe(true)
    // A rebuilt list recreates the row; it does not enter again.
    expect(fresh.check("later")).toBe(false)
    fresh.dispose()
  })
})
