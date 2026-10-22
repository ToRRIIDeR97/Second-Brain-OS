import { describe, expect, test } from "bun:test"
import { SessionTitle } from "../../../../opencode/packages/core/src/session/title"

const fresh = `New session - ${new Date(1_700_000_000_000).toISOString()}`

describe("verify AC-2 / AC-3 title rules", () => {
  test("AC-3 child sessions are never titled", () => {
    expect(SessionTitle.eligible({ parentID: "ses_parent", title: fresh, userMessages: 1 })).toBe(false)
  })

  test("AC-3 no user message yet means no title", () => {
    expect(SessionTitle.eligible({ title: fresh, userMessages: 0 })).toBe(false)
  })

  test("AC-3 a title that only resembles the default is a real title", () => {
    expect(SessionTitle.isDefault("New session about billing")).toBe(false)
  })

  test("AC-2 a reply that is only a think block produces no title", () => {
    expect(SessionTitle.clean("<think>a\nb</think>\n")).toBeUndefined()
  })

  test("AC-2 several think blocks are removed", () => {
    expect(SessionTitle.clean("<think>x</think><think>y</think>Plan the release")).toBe("Plan the release")
  })

  test("AC-2 a 100-character title is kept whole", () => {
    expect(SessionTitle.clean("b".repeat(100))).toBe("b".repeat(100))
  })
})
