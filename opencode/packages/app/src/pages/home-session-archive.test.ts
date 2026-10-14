import { expect, test } from "bun:test"
import { archiveHomeSession } from "./home-session-archive"
import type { ServerConnection } from "@/context/server"

const remote = "remote" as ServerConnection.Key

test("archiving a Home session removes it from the list", async () => {
  let removed = false

  await archiveHomeSession({
    server: remote,
    session: { id: "ses_1", directory: "/workspace" },
    archive: async () => undefined,
    remove: () => {
      removed = true
    },
  })

  expect(removed).toBe(true)
})

test("reports archive failures without removing the session", async () => {
  const failure = new Error("offline")
  let error: unknown
  let removed = false

  await archiveHomeSession({
    server: remote,
    session: { id: "ses_1", directory: "/workspace" },
    archive: async () => Promise.reject(failure),
    remove: () => {
      removed = true
    },
    onError: (value) => {
      error = value
    },
  })

  expect(error).toBe(failure)
  expect(removed).toBe(false)
})
