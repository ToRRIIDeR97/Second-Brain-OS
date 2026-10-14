import { expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import { promptStateKey } from "@/context/prompt"

test("keys remembered prompts by the explicitly scoped thread or draft", () => {
  const server = ServerConnection.Key.make("local")

  expect(promptStateKey({ dir: "repo", id: "B" }, server)).toBe("session:local\nB")
  expect(promptStateKey({ draftID: "d1" }, server)).toBe("draft:d1")
  expect(promptStateKey({ dir: "repo" }, server)).toBeUndefined()
})
