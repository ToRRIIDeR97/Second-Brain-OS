import { describe, expect, test } from "bun:test"
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
  test("treats the first non-empty render as seen, then marks only later ids", async () => {
    const check = createFreshItems()
    // The list mounted empty; its query resolves later and renders every row in one pass.
    await Promise.resolve()
    expect(check("first")).toBe(false)
    expect(check("second")).toBe(false)
    await Promise.resolve()
    expect(check("first")).toBe(false)
    expect(check("later")).toBe(true)
    // A rebuilt list recreates the row; it does not enter again.
    expect(check("later")).toBe(false)
  })
})
