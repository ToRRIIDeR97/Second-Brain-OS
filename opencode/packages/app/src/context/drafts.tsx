import { createSimpleContext } from "@opencode-ai/ui/context"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, getOwner, onCleanup, startTransition } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Harness } from "@opencode-ai/schema/harness"
import { draftPersistedKeys, Persist, persisted, removePersisted, removeWindowPersisted } from "@/utils/persist"
import { sessionHref } from "@/utils/session-route"
import { uuid } from "@/utils/uuid"
import { usePlatform } from "./platform"
import { createDraftPromptSession, type PromptModel } from "./prompt-state"
import { ServerConnection, useServer } from "./server"
import { createStateMemory } from "./state-memory"

/** An unsent thread: the composer state lives in the draft store, keyed by `draftID`. */
export type Draft = {
  draftID: string
  server: ServerConnection.Key
  /** Directory the thread will run in (the Project's thread directory). */
  directory: string
  /** Second Brain Project the thread belongs to, when known. */
  projectID?: string
  worktree?: string
}

export type DraftInput = Omit<Draft, "draftID">

export const NEW_THREAD_PATH = "/new-thread"

export const draftHref = (draft: Pick<Draft, "draftID" | "projectID">) => {
  const search = new URLSearchParams()
  if (draft.projectID) search.set("project", draft.projectID)
  search.set("draftId", draft.draftID)
  return `${NEW_THREAD_PATH}?${search.toString()}`
}

/** Memory key for per-draft reactive state such as the prompt session. */
export const draftStateKey = (draftID: string) => `draft:${draftID}`
/** Memory key for per-thread reactive state such as the prompt session. */
export const sessionStateKey = (server: ServerConnection.Key, sessionID: string) => `session:${server}\n${sessionID}`

const LEGACY_TAB_KEYS = ["tabs", "tabs.recent", "tabs.info", "tabs.closed"]
const STATE_MEMORY_LIMIT = 40

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parseDraft(value: unknown, fallback?: ServerConnection.Key): Draft | undefined {
  if (!isRecord(value)) return
  const server = typeof value.server === "string" ? (value.server as ServerConnection.Key) : fallback
  if (!server) return
  if (typeof value.draftID !== "string" || typeof value.directory !== "string") return
  if (value.worktree !== undefined && typeof value.worktree !== "string") return
  if (value.projectID !== undefined && typeof value.projectID !== "string") return
  return {
    draftID: value.draftID,
    server,
    directory: value.directory,
    ...(typeof value.projectID === "string" ? { projectID: value.projectID } : {}),
    ...(typeof value.worktree === "string" ? { worktree: value.worktree } : {}),
  }
}

/** Validate persisted drafts, dropping malformed entries. */
export function migrateDrafts(value: unknown): Draft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => parseDraft(item) ?? [])
}

/**
 * Pull unsent drafts out of the retired per-window tab list so they survive the
 * removal of the tab strip. Session tabs are dropped; the sidebar lists threads.
 */
export function draftsFromLegacyTabs(value: unknown, fallback: ServerConnection.Key): Draft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || item.type !== "draft") return []
    return parseDraft(item, fallback) ?? []
  })
}

/** A Home draft sends on arrival only with the harness it was started with, and only while that harness is available. */
export function canSendOnOpen(
  requested: Harness.InstanceID | undefined,
  instance: Pick<Harness.Instance, "id" | "status"> | undefined,
) {
  if (instance?.status !== "available") return false
  return !requested || instance.id === requested
}

export function mergeDrafts(current: Draft[], incoming: Draft[]) {
  const known = new Set(current.map((draft) => draft.draftID))
  return [...current, ...incoming.filter((draft) => !known.has(draft.draftID))]
}

export const { use: useDrafts, provider: DraftsProvider } = createSimpleContext({
  name: "Drafts",
  gate: false,
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const navigate = useNavigate()
    const location = useLocation()
    const memory = createStateMemory(getOwner(), STATE_MEMORY_LIMIT)
    onCleanup(memory.dispose)

    const [store, setStore, , ready] = persisted(
      { ...Persist.window("drafts"), migrate: migrateDrafts },
      createStore<Draft[]>([]),
    )
    // One-time upgrade: import drafts from the retired tab strip, then delete its keys.
    const [legacyTabs, , , legacyReady] = persisted(Persist.window("tabs"), createStore<unknown[]>([]))
    let legacyImported = false
    createEffect(() => {
      if (legacyImported || !ready() || !legacyReady()) return
      legacyImported = true
      const imported = draftsFromLegacyTabs([...legacyTabs], server.key)
      if (imported.length > 0) setStore((drafts) => mergeDrafts(drafts, imported))
      if (legacyTabs.length === 0) return
      for (const key of LEGACY_TAB_KEYS) removeWindowPersisted(key, platform)
    })

    const removeDraftPersisted = (draftID: string) => {
      for (const key of draftPersistedKeys()) {
        const target = Persist.draft(draftID, key)
        removePersisted(key === "prompt" ? Persist.prompt(target) : target, platform)
      }
    }

    const removeDraft = (draftID: string) => {
      setStore((drafts) => drafts.filter((draft) => draft.draftID !== draftID))
      memory.remove(draftStateKey(draftID))
      removeDraftPersisted(draftID)
    }

    // Drop drafts whose server was removed from the server list.
    createEffect(() => {
      if (!ready()) return
      const servers = new Set(server.list.map(ServerConnection.key))
      for (const draft of store) {
        if (!servers.has(draft.server)) removeDraft(draft.draftID)
      }
    })

    // Drafts started from Home send on arrival. Kept in memory only, so a reload never re-sends.
    const pendingSend = new Map<string, Harness.InstanceID | undefined>()

    const isActive = (draftID: string) => location.pathname === NEW_THREAD_PATH && location.query.draftId === draftID

    return {
      ready,
      list: store,
      get(draftID: string | undefined) {
        if (!draftID) return
        return store.find((draft) => draft.draftID === draftID)
      },
      async create(
        input: DraftInput,
        prompt?: string,
        model?: PromptModel,
        harnessInstanceID?: Harness.InstanceID,
        options?: { send?: boolean; harnessModel?: Harness.ModelSelection },
      ) {
        const draft: Draft = { draftID: uuid(), ...input }
        if (options?.send && prompt?.trim()) pendingSend.set(draft.draftID, harnessInstanceID)
        memory.ensure(draftStateKey(draft.draftID), "prompt", () =>
          createDraftPromptSession(draft.draftID, {
            prompt,
            model,
            harnessInstanceID,
            harnessModel: options?.harnessModel,
          }),
        )
        await startTransition(() => {
          setStore(
            produce((drafts) => {
              drafts.push(draft)
            }),
          )
          navigate(draftHref(draft))
        })
        return draft
      },
      /** Consumes the send-on-open request for a draft. Returns the harness it was started with. */
      takeSend(draftID: string) {
        if (!pendingSend.has(draftID)) return
        const harnessInstanceID = pendingSend.get(draftID)
        pendingSend.delete(draftID)
        return { harnessInstanceID }
      },
      update(draftID: string, patch: Partial<DraftInput>) {
        setStore(
          (draft) => draft.draftID === draftID,
          produce((draft) => Object.assign(draft, patch)),
        )
      },
      /** Replace a sent draft with its new thread; navigates to it when the draft is on screen. */
      promote(draftID: string, session: { server: ServerConnection.Key; sessionID: string }) {
        const active = isActive(draftID)
        void startTransition(() => {
          setStore((drafts) => drafts.filter((draft) => draft.draftID !== draftID))
          if (active) navigate(sessionHref(session.server, session.sessionID))
        })
        memory.remove(draftStateKey(draftID))
        removeDraftPersisted(draftID)
      },
      remove(draftID: string) {
        const active = isActive(draftID)
        removeDraft(draftID)
        if (active) navigate("/")
      },
      removeServer(key: ServerConnection.Key) {
        for (const draft of store.filter((item) => item.server === key)) removeDraft(draft.draftID)
        if (server.key === key) navigate("/")
      },
      /** Reactive state kept across route remounts, keyed by `draftStateKey` or `sessionStateKey`. */
      state<T>(key: string, name: string, init: () => T) {
        return memory.ensure(key, name, init)
      },
      stateValue<T>(key: string, name: string) {
        return memory.get<T>(key, name)
      },
    }
  },
})
