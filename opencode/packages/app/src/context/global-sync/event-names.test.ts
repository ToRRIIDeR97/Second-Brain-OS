import { describe, expect, test } from "bun:test"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { SERVER_EVENT_NAMES, isSessionMovedEvent, isSessionRevertEvent, sessionMovedData } from "./event-names"

describe("SERVER_EVENT_NAMES", () => {
  test("every name the app relies on is a server event definition", () => {
    const defined = new Set(EventManifest.Definitions.map((definition) => definition.type))
    const names = Object.values(SERVER_EVENT_NAMES).flat()
    expect(names.filter((name) => !defined.has(name))).toEqual([])
  })

  test("matches current and legacy session event names", () => {
    expect(isSessionMovedEvent("session.next.moved")).toBe(true)
    expect(isSessionMovedEvent("session.moved")).toBe(true)
    expect(isSessionMovedEvent("session.next.prompted")).toBe(false)
    expect(isSessionRevertEvent("session.next.revert.committed")).toBe(true)
    expect(isSessionRevertEvent("session.revert.staged")).toBe(true)
    expect(isSessionRevertEvent(undefined)).toBe(false)
  })

  test("reads current and legacy moved payloads", () => {
    expect(sessionMovedData({ sessionID: "a", location: { directory: "/x" }, subdirectory: "pkg" })).toEqual({
      sessionID: "a",
      directory: "/x",
      workspaceID: undefined,
      projectID: undefined,
      path: "pkg",
    })
    expect(
      sessionMovedData({
        sessionID: "a",
        location: { directory: "/x", workspaceID: "w" },
        projectID: "p",
        subpath: "s",
      }),
    ).toMatchObject({ workspaceID: "w", projectID: "p", path: "s" })
    expect(sessionMovedData({ sessionID: "a" })).toBeUndefined()
    expect(sessionMovedData(undefined)).toBeUndefined()
  })
})
