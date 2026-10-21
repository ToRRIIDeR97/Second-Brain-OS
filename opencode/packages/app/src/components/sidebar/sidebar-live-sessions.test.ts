import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { QueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { applyDirectoryEvent } from "@/context/global-sync/event-reducer"
import {
  createHomeSessionIndexCache,
  type HomeSessionEvent,
  type HomeSessionEvents,
  type HomeSessionIndex,
} from "@/context/global-sync/home-session-index"
import type { State } from "@/context/global-sync/types"
import { groupSidebarThreads, mergeSidebarSessions } from "@/features/second-brain/sidebar-threads"

// Mirrors the live path: server-sync applies each session event to the shared home index
// and to the event directory's child store; the sidebar merges both and groups them.

const BRAIN = "/brain"
const PROJECT_A = "/work/a"
const PROJECT_B = "/work/b"
const projects = [
  { id: "prj_a", threadDirectory: PROJECT_A },
  { id: "prj_b", threadDirectory: PROJECT_B },
]

const session = (id: string, directory: string, extra: { updated?: number; archived?: number; pinned?: number } = {}) =>
  ({
    id,
    slug: id,
    projectID: "project",
    directory,
    title: id,
    version: "",
    time: { created: 1, updated: extra.updated ?? 1, archived: extra.archived },
    metadata: extra.pinned === undefined ? undefined : { pinned: extra.pinned },
  }) as Session

const childState = () =>
  ({
    status: "complete",
    agent: [],
    command: [],
    project: "",
    provider: {},
    config: {},
    path: { directory: "/tmp" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp: {},
    lsp: [],
    limit: 10,
    message: {},
    session_message: {},
    part: {},
    part_text_accum_delta: {},
  }) as unknown as State

function setup() {
  const queryClient = new QueryClient()
  const home = createHomeSessionIndexCache(queryClient, "server")
  queryClient.setQueryData<HomeSessionIndex>(home.indexKey, { sessions: [], eventSequence: 0 })
  const stores = new Map([BRAIN, PROJECT_A, PROJECT_B].map((directory) => [directory, createStore(childState())]))

  const emit = (directory: string, event: HomeSessionEvent) => {
    home.apply(event)
    const store = stores.get(directory)
    if (!store) return
    applyDirectoryEvent({ event, directory, store: store[0], setStore: store[1], push() {}, loadLsp() {} })
  }
  const groups = () => {
    const index = home.sessions(
      queryClient.getQueryData<HomeSessionIndex>(home.indexKey),
      queryClient.getQueryData<HomeSessionEvents>(home.eventsKey),
    )
    const lists = [...stores].map(([directory, [store]]) => ({ directory, sessions: store.session }))
    const grouped = groupSidebarThreads({
      projects,
      workspaceDirectory: BRAIN,
      sessions: mergeSidebarSessions(lists, index),
    })
    return {
      a: grouped.projects[0]!.threads.map((node) => node.session.id),
      b: grouped.projects[1]!.threads.map((node) => node.session.id),
      workspace: grouped.workspace.map((node) => node.session.id),
    }
  }
  return { emit, groups, stores }
}

const created = (info: Session): HomeSessionEvent => ({
  type: "session.created",
  properties: { sessionID: info.id, info },
})
const updated = (info: Session): HomeSessionEvent => ({
  type: "session.updated",
  properties: { sessionID: info.id, info },
})

describe("live session events reach the sidebar lists", () => {
  test("a thread created in a background Project and in an unlisted workspace folder appears", () => {
    const { emit, groups } = setup()
    emit(PROJECT_B, created(session("b1", PROJECT_B)))
    emit(PROJECT_A, created(session("a1", PROJECT_A)))
    emit("/brain/development/tool", created(session("o1", "/brain/development/tool")))
    emit("/tmp/scratch", created(session("x1", "/tmp/scratch")))
    expect(groups()).toEqual({ a: ["a1"], b: ["b1"], workspace: ["o1"] })
  })

  test("archive removes the thread, unarchive brings it back", () => {
    const { emit, groups, stores } = setup()
    const thread = session("a1", PROJECT_A)
    emit(PROJECT_A, created(thread))
    // The Brain list can hold a copy of the same thread; it never receives the thread's events.
    stores.get(BRAIN)![1]("session", [thread])

    emit(PROJECT_A, updated(session("a1", PROJECT_A, { updated: 2, archived: 2 })))
    expect(groups().a).toEqual([])

    emit(PROJECT_A, updated(session("a1", PROJECT_A, { updated: 3 })))
    expect(groups().a).toEqual(["a1"])
  })

  test("pinning moves a thread to the top", () => {
    const { emit, groups } = setup()
    emit(PROJECT_A, created(session("a1", PROJECT_A, { updated: 1 })))
    emit(PROJECT_A, created(session("a2", PROJECT_A, { updated: 2 })))
    expect(groups().a).toEqual(["a2", "a1"])

    emit(PROJECT_A, updated(session("a1", PROJECT_A, { updated: 1, pinned: 5 })))
    expect(groups().a).toEqual(["a1", "a2"])
  })
})
