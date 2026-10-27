import { describe, expect, test } from "bun:test"
import { nextPageMotionKey, routeSection } from "./page-motion"

describe("page motion key", () => {
  test("groups draft and session routes into the thread section", () => {
    expect(routeSection("/new-thread")).toBe("thread")
    expect(routeSection("/server/abc/session/ses_1")).toBe("thread")
    expect(routeSection("/notes")).toBe("/notes")
  })

  test("changes between pages and out of a thread, but not into one", () => {
    const home = { section: "/", count: 0 }
    const notes = nextPageMotionKey(home, "/notes")
    expect(notes.count).toBe(1)
    expect(nextPageMotionKey(notes, "/notes")).toBe(notes)
    const thread = nextPageMotionKey(notes, "/new-thread")
    expect(thread.count).toBe(1)
    expect(nextPageMotionKey(thread, "/server/abc/session/ses_1")).toBe(thread)
    expect(nextPageMotionKey(thread, "/notes").count).toBe(2)
  })
})
