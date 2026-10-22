import { describe, expect, test } from "bun:test"
import { SessionTitle } from "../../../../opencode/packages/core/src/session/title"

describe("AC-2 / AC-3 session title rules", () => {
  test("AC-3 recognizes the default title the store creates", () => {
    expect(SessionTitle.isDefault(`New session - ${new Date(0).toISOString()}`)).toBe(true)
    expect(SessionTitle.isDefault("Fix login redirect")).toBe(false)
  })

  test("AC-2 keeps the first non-empty line and drops think blocks", () => {
    expect(SessionTitle.clean("<think>pondering</think>\n\n  Fix login redirect  \nsecond line")).toBe(
      "Fix login redirect",
    )
  })

  test("AC-2 caps titles at 100 characters", () => {
    const title = SessionTitle.clean("a".repeat(150))!
    expect(title.length).toBe(100)
    expect(title.endsWith("...")).toBe(true)
  })

  test("AC-3 an empty model reply produces no title", () => {
    expect(SessionTitle.clean("   \n\n")).toBeUndefined()
  })

  test("AC-2 a top-level default-titled session with one user message is eligible", () => {
    const title = `New session - ${new Date(0).toISOString()}`
    expect(SessionTitle.eligible({ title, userMessages: 1 })).toBe(true)
  })

  test("AC-3 renamed sessions and later turns are not retitled", () => {
    const title = `New session - ${new Date(0).toISOString()}`
    expect(SessionTitle.eligible({ title: "Named", userMessages: 1 })).toBe(false)
    expect(SessionTitle.eligible({ title, userMessages: 2 })).toBe(false)
  })
})
