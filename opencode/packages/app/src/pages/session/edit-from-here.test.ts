import { describe, expect, test } from "bun:test"
import { editFromHereFiles } from "./edit-from-here"

describe("editFromHereFiles", () => {
  test("unions the files changed by the selected turn and every later turn", async () => {
    const turns: Record<string, string[]> = { u1: ["a.ts"], u2: ["b.ts", "a.ts"], u3: ["c.ts"] }
    const asked: string[] = []
    const files = await editFromHereFiles({
      diff: async ({ messageID }) => {
        asked.push(messageID)
        return (turns[messageID] ?? []).map((file) => ({ file }))
      },
      sessionID: "ses",
      messageID: "u2",
      userMessageIDs: ["u1", "u2", "u3"],
    })
    expect(asked).toEqual(["u2", "u3"])
    expect(files).toEqual(["a.ts", "b.ts", "c.ts"])
  })
})
