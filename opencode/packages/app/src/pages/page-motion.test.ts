import { describe, expect, test } from "bun:test"
import { nextPageMotionKey, routeSection } from "./page-motion"

describe("page motion key", () => {
  test("groups draft and session routes into the thread section", () => {
    expect(routeSection("/new-thread")).toBe("thread")
    expect(routeSection("/server/abc/session/ses_1")).toBe("thread")
    expect(routeSection("/notes")).toBe("/notes")
  })

  test("gives the cross-project overview its own section", () => {
    expect(routeSection("/projects/overview")).toBe("/projects/overview")
    expect(routeSection("/projects/overview/")).toBe("/projects/overview")
    const projects = { section: "/projects", count: 1 }
    expect(nextPageMotionKey(projects, "/projects/overview").count).toBe(2)
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

  test("counts redirect paths as the section they lead to", () => {
    expect(routeSection("/brain")).toBe("/")
    expect(routeSection("/workspaces")).toBe("/")
    expect(routeSection("/somewhere/unknown")).toBe("/")
    expect(routeSection("/notes/")).toBe("/notes")
    expect(routeSection("/new-session")).toBe("thread")
    expect(routeSection("/L3Byb2plY3Q/session")).toBe("thread")
    expect(routeSection("/L3Byb2plY3Q/session/ses_1")).toBe("thread")
    // A deep link through a legacy session path reaches the thread view without a fade.
    const home = { section: "/", count: 0 }
    const legacy = nextPageMotionKey(home, "/L3Byb2plY3Q/session/ses_1")
    expect(nextPageMotionKey(legacy, "/server/abc/session/ses_1")).toBe(legacy)
    expect(legacy.count).toBe(0)
    expect(nextPageMotionKey(home, "/brain")).toBe(home)
  })
})
