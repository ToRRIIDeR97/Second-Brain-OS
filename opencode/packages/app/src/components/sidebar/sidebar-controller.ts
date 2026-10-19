import type { Session } from "@opencode-ai/sdk/v2/client"
import { useLocation, useNavigate } from "@solidjs/router"
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createComputed, createEffect, createMemo, createResource, onCleanup, onMount } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useDirectoryPicker } from "@/components/directory-picker"
import { outsideEditable, useCommand } from "@/context/command"
import { useDrafts } from "@/context/drafts"
import {
  loadHomeSessionIndex,
  retainHomeSessions,
  type HomeSessionEvents,
} from "@/context/global-sync/home-session-index"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import {
  ensureWorkspaceProject,
  listProjectThreads,
  updateProject,
  type ProjectThreads,
} from "@/features/second-brain/client"
import {
  flattenThreads,
  groupSidebarThreads,
  mergeSidebarSessions,
  projectForDirectory,
  type ThreadNode,
} from "@/features/second-brain/sidebar-threads"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "@/pages/layout/deep-links"
import { errorMessage, homeProjectDirectories } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"
import { Persist, persisted } from "@/utils/persist"
import { sessionHref } from "@/utils/session-route"
import { normalizeSessionInfo } from "@/utils/session"
import { sessionTitle } from "@/utils/session-title"
import { dismissToast, showToast } from "@/utils/toast"
import { createUndoQueue } from "@/utils/undo-action"

export type SidebarProjectItem = {
  id: string
  name: string
  threadDirectory: string
  entry: ProjectThreads
}

export const BRAIN_GROUP = "__brain__"
export const OTHER_GROUP = "__other__"
const OTHER_THREAD_LIMIT = 50
const HOME_SESSION_LIMIT = 64
const ARCHIVED_THREAD_LIMIT = 500

export const projectThreadsQueryKey = (server: string, brain: string | undefined) =>
  ["second-brain", "project-threads", server, brain ?? ""] as const

// Call after every Project mutation so the sidebar's Project list and threads catch up.
export const invalidateProjectThreads = (queryClient: QueryClient, server: string) =>
  queryClient.invalidateQueries({ queryKey: ["second-brain", "project-threads", server] })

export function createSidebarController() {
  const layout = useLayout()
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const platform = usePlatform()
  const drafts = useDrafts()
  const command = useCommand()
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const pickDirectory = useDirectoryPicker()

  const [state, setState] = persisted(
    Persist.window("sidebar"),
    createStore({ current: undefined as string | undefined, expanded: {} as Record<string, boolean> }),
  )

  // The Brain is the Workspace selected on Home; its Second Brain data lives there.
  const brainDirectory = createMemo(() => {
    const available = layout.projects.list()
    const preferred = layout.home.selection().directory
    return available.find((item) => item.worktree === preferred)?.worktree ?? available[0]?.worktree
  })
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })

  const projectsQuery = useQuery(() => ({
    queryKey: projectThreadsQueryKey(server.key, brainDirectory()),
    enabled: !!brainDirectory(),
    queryFn: () => listProjectThreads(client(brainDirectory()!)),
    staleTime: 30_000,
    retry: false,
  }))
  const projects = createMemo<SidebarProjectItem[]>(() =>
    (Array.isArray(projectsQuery.data) ? projectsQuery.data : [])
      .filter((entry) => entry.project.status === "active")
      .map((entry) => ({
        id: entry.project.id,
        name: entry.project.name,
        threadDirectory: entry.threadDirectory,
        entry,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  const refreshProjects = () => invalidateProjectThreads(queryClient, server.key)

  // Per-directory thread lists, kept live by session.created/updated/deleted events.
  const directories = createMemo(() => {
    const brain = brainDirectory()
    const all = [...projects().map((project) => project.threadDirectory), ...(brain ? [brain] : [])]
    return [...new Map(all.map((directory) => [pathKey(directory), directory] as const)).values()]
  })
  createEffect(() => {
    for (const directory of directories()) void serverSync().project.loadSessions(directory)
  })
  const directoryLists = createMemo(() =>
    directories().map((directory) => ({
      directory,
      sessions: serverSync().child(directory, { bootstrap: false })[0].session,
    })),
  )

  // Recent threads across every folder, so threads outside any Project still show.
  // Reads the cache that `serverSync().homeSessions` keeps live from server events,
  // the same one Home reads (the shell shares the app's QueryClient).
  const homeSessions = () => serverSync().homeSessions
  const sessionEvents = useQuery(() => ({
    queryKey: homeSessions().eventsKey,
    queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
    initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
    enabled: false,
  }))
  const sessionIndex = useQuery(() => ({
    queryKey: homeSessions().indexKey,
    queryFn: async ({ signal }) => {
      const cache = homeSessions()
      const sequence = cache.eventSequence()
      const index = await loadHomeSessionIndex(
        (input, options) => serverSDK().client.v2.session.list(input, options),
        sequence,
        signal,
      )
      cache.complete(sequence)
      return index
    },
    retry: false,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
  }))
  // Reconciled so a refetch that returns the same threads (e.g. after a reconnect) keeps
  // their identity and does not re-render every row.
  const [indexStore, setIndexStore] = createStore({ sessions: [] as Session[] })
  createComputed(() =>
    setIndexStore(
      "sessions",
      reconcile(
        retainHomeSessions(
          homeSessions().sessions(sessionIndex.data, sessionEvents.data),
          HOME_SESSION_LIMIT,
          Date.now(),
        ),
        { key: "id" },
      ),
    ),
  )

  // `hidden` holds threads whose delete waits for its undo window to close; their children hide too.
  const [local, setLocal] = createStore({ hidden: {} as Record<string, boolean>, undoPending: 0 })
  const sessions = createMemo<Session[]>(() => {
    const all = mergeSidebarSessions(directoryLists(), indexStore.sessions)
    const parents = new Map(all.map((session) => [session.id, session.parentID] as const))
    const hidden = (id: string | undefined, depth = 0): boolean =>
      !!id && depth < 64 && (local.hidden[id] || hidden(parents.get(id), depth + 1))
    return all.filter((session) => !hidden(session.id))
  })
  const groups = createMemo(() => {
    const grouped = groupSidebarThreads({
      projects: projects(),
      brainDirectory: brainDirectory(),
      sessions: sessions(),
    })
    return { ...grouped, other: grouped.other.slice(0, OTHER_THREAD_LIMIT) }
  })

  const route = layout.route
  const activeSessionID = createMemo(() => {
    const value = route()
    if (value.type !== "session" || value.server !== server.key) return
    return value.sessionId
  })
  const activeDraft = createMemo(() => {
    const value = route()
    if (value.type !== "draft") return
    return drafts.get(value.draftID)
  })
  const knownSession = (sessionID: string) =>
    sessions().find((session) => session.id === sessionID) ?? serverSync().session.get(sessionID)
  const [fetchedSession] = createResource(
    () => {
      const sessionID = activeSessionID()
      if (!sessionID || knownSession(sessionID)) return
      return sessionID
    },
    (sessionID) =>
      serverSDK()
        .api.session.get({ sessionID })
        .then(normalizeSessionInfo)
        .catch(() => undefined),
  )
  const activeDirectory = createMemo(() => {
    const draft = activeDraft()
    if (draft) return draft.directory
    const sessionID = activeSessionID()
    if (!sessionID) return
    return knownSession(sessionID)?.directory ?? fetchedSession()?.directory
  })
  /** Project the current route belongs to, derived from the thread or draft directory. */
  const activeProjectID = createMemo(() => {
    const draft = activeDraft()
    if (draft?.projectID) return draft.projectID
    const directory = activeDirectory()
    if (!directory) return
    const project = projectForDirectory(projects(), directory)
    if (project) return project.id
    const brain = brainDirectory()
    if (brain && pathKey(brain) === pathKey(directory)) return BRAIN_GROUP
  })
  createEffect(() => {
    const id = activeProjectID()
    if (!id) return
    if (state.current !== id) setState("current", id)
    if (!state.expanded[id]) setState("expanded", id, true)
  })
  const currentProject = createMemo(() => {
    const id = activeProjectID() ?? state.current
    return projects().find((project) => project.id === id)
  })

  const expanded = (id: string) => state.expanded[id] ?? false
  const toggleExpanded = (id: string) => setState("expanded", id, !expanded(id))

  const visibleThreads = createMemo(() => {
    const value = groups()
    const nodes: ThreadNode<Session>[] = [
      ...value.projects.flatMap((group) => (expanded(group.project.id) ? group.threads : [])),
      ...(expanded(BRAIN_GROUP) ? value.brain : []),
      ...(expanded(OTHER_GROUP) ? value.other : []),
    ]
    return flattenThreads(nodes)
  })

  const openThread = (session: Pick<Session, "id">) => navigate(sessionHref(server.key, session.id))

  const newThread = (project?: SidebarProjectItem) => {
    const target = project ?? currentProject()
    if (target) {
      void drafts.create({ server: server.key, directory: target.threadDirectory, projectID: target.id })
      return
    }
    const brain = brainDirectory()
    if (brain) void drafts.create({ server: server.key, directory: brain })
  }

  const newBrainThread = () => {
    const brain = brainDirectory()
    if (brain) void drafts.create({ server: server.key, directory: brain })
  }

  const requestFailed = (cause: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(cause, language.t("common.requestFailed")),
    })

  const undo = createUndoQueue({
    show: (action, run) =>
      showToast({
        title: action.title,
        description: action.description,
        persistent: true,
        actions: [{ label: language.t("secondBrain.sidebar.undo"), onClick: run }],
      }),
    dismiss: dismissToast,
    onChange: (pending) => setLocal("undoPending", pending),
    onError: requestFailed,
  })
  onCleanup(() => undo.flush())

  const threadLabel = (session: Session) => sessionTitle(session.title) || session.id

  // A directory's list holds every thread of its OpenCode project, so a thread can sit in
  // several loaded lists (e.g. the Brain folder and a `projects/<id>/` folder). Update them all.
  const loadedStores = () => directories().map((directory) => serverSync().child(directory, { bootstrap: false }))
  const dropSession = (sessionID: string) => {
    for (const [, setStore] of loadedStores())
      setStore("session", (items) => items.filter((item) => item.id !== sessionID))
  }

  // Apply the server's copy right away; the later session.updated event is idempotent.
  const applySession = (info: Session) => {
    homeSessions().apply({ type: "session.updated", properties: { sessionID: info.id, info } })
    if (info.time.archived) return dropSession(info.id)
    for (const [store, setStore] of loadedStores()) {
      const index = store.session.findIndex((item) => item.id === info.id)
      if (index !== -1) setStore("session", index, info)
    }
    if (!directories().some((directory) => pathKey(directory) === pathKey(info.directory))) return
    const [own, setOwn] = serverSync().child(info.directory, { bootstrap: false })
    if (own.session.some((item) => item.id === info.id)) return
    setOwn("session", (items) => [...items, info].sort((a, b) => a.id.localeCompare(b.id)))
  }

  // Move off a thread that is about to leave the sidebar: to its parent, a neighbour, or Home.
  const leaveThread = (session: Session) => {
    if (activeSessionID() !== session.id) return
    const order = visibleThreads()
    const index = order.findIndex((item) => item.id === session.id)
    const next = order[index + 1] ?? order[index - 1]
    if (session.parentID) openThread({ id: session.parentID })
    else if (next && next.id !== session.id) openThread(next)
    else navigate("/")
  }

  const rename = async (session: Session, title: string, previous: string) => {
    const update = (value: string) => {
      for (const [, setStore] of loadedStores())
        setStore(
          "session",
          (item) => item.id === session.id,
          produce((item) => {
            item.title = value
          }),
        )
      // Recent threads outside any loaded list read the Home index, so rename (and roll back) there too.
      homeSessions().apply({
        type: "session.updated",
        properties: { sessionID: session.id, info: { ...session, title: value } },
      })
    }
    update(title)
    await serverSDK()
      .api.session.rename({ sessionID: session.id, title, directory: session.directory })
      .catch((cause: unknown) => {
        update(previous)
        throw cause
      })
  }

  const renameThread = async (session: Session, title: string) => {
    const next = title.trim()
    const previous = session.title
    if (!next || next === previous) return
    await rename(session, next, previous)
      .then(() =>
        undo.push({
          title: language.t("secondBrain.sidebar.threadRenamed"),
          description: next,
          undo: () => rename(session, previous, next),
        }),
      )
      .catch(requestFailed)
  }

  const archiveThread = async (session: Session) => {
    await serverSDK()
      .client.session.update(
        { sessionID: session.id, directory: session.directory, time: { archived: Date.now() } },
        { throwOnError: true },
      )
      .then((result) => {
        leaveThread(session)
        applySession(result.data)
        undo.push({
          title: language.t("secondBrain.sidebar.threadArchived"),
          description: threadLabel(session),
          undo: () => unarchiveThread(session),
        })
      })
      .catch(requestFailed)
  }

  const unarchiveThread = (session: Pick<Session, "id" | "directory">) =>
    serverSDK()
      .client.session.update(
        { sessionID: session.id, directory: session.directory, time: { archived: null } },
        { throwOnError: true },
      )
      .then((result) => applySession(result.data))

  /**
   * Delete is deferred: the row hides now and `session.remove` (a hard delete) runs when the
   * undo window closes. If the app quits first, the thread is simply not deleted.
   */
  const deleteThread = (session: Session) => {
    leaveThread(session)
    setLocal("hidden", session.id, true)
    const restore = () => setLocal("hidden", session.id, false)
    undo.push({
      title: language.t("secondBrain.sidebar.threadDeleted"),
      description: threadLabel(session),
      undo: restore,
      commit: () =>
        serverSDK()
          .api.session.remove({ sessionID: session.id, directory: session.directory })
          .then(() => {
            dropSession(session.id)
            homeSessions().apply({ type: "session.deleted", properties: { sessionID: session.id, info: session } })
          })
          .catch((cause: unknown) => {
            restore()
            throw cause
          }),
    })
  }

  const setThreadPinned = (session: Session, pinned: boolean) =>
    serverSDK()
      .client.session.update({ sessionID: session.id, directory: session.directory, pinned }, { throwOnError: true })
      .then((result) => applySession(result.data))
      .catch(requestFailed)

  const forkThread = async (session: Session) => {
    await serverSDK()
      .api.session.fork({ sessionID: session.id })
      .then((forked) => openThread(forked))
      .catch(requestFailed)
  }

  const openProjectCard = (project: SidebarProjectItem) =>
    navigate(`/projects?project=${encodeURIComponent(project.id)}`)

  const archiveProject = async (project: SidebarProjectItem) => {
    const brain = brainDirectory()
    if (!brain) return
    const previous = project.entry.project.status
    await updateProject(client(brain), project.id, {
      status: "archived",
      expectedUpdatedAt: project.entry.project.updatedAt,
    })
      .then(async (archived) => {
        await refreshProjects()
        undo.push({
          title: language.t("secondBrain.sidebar.projectArchived"),
          description: project.name,
          undo: () =>
            updateProject(client(brain), project.id, { status: previous, expectedUpdatedAt: archived.updatedAt }).then(
              refreshProjects,
            ),
        })
      })
      .catch(requestFailed)
  }

  /** Archived threads in a Project's thread folder, newest first, within the list limit. */
  const listArchivedThreads = (project: SidebarProjectItem) =>
    serverSDK()
      .client.experimental.session.list(
        { directory: project.threadDirectory, archived: true, limit: ARCHIVED_THREAD_LIMIT },
        { throwOnError: true },
      )
      .then((result) => result.data.filter((session) => !!session.time.archived) as Session[])

  /**
   * Open a folder and make sure a Project links to it (Phase 3 merged Project model).
   * `initEmpty` runs `git init` in an empty folder; only user-picked folders get it, never deep links.
   */
  const openFolder = async (directory: string, options: { initEmpty?: boolean } = {}) => {
    layout.projects.open(directory)
    server.projects.touch(directory)
    const sdk = serverSDK()
    const location = { directory }
    const current = () => sdk.api.project.current({ location })
    // Only an `initEmpty` open needs to know whether the folder is empty.
    const project = await (
      options.initEmpty
        ? sdk.api.file.list({ path: ".", location }).then(async (files) => {
            if (files.data.length > 0) return current()
            const result = await sdk.client.project.initGit({ directory })
            return result.data ?? current()
          })
        : current()
    ).catch(() => undefined)
    if (!project) return
    serverSync().child(directory, { bootstrap: false })[1]("project", project.id)
    const brain = brainDirectory()
    if (project.id === "global" || !brain || pathKey(brain) === pathKey(directory)) return
    const linked = await ensureWorkspaceProject(client(brain), project.id).catch(() => undefined)
    await refreshProjects()
    if (!linked) return
    setState("current", linked.id)
    setState("expanded", linked.id, true)
  }

  const chooseFolder = () =>
    pickDirectory({
      server: server.current!,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        for (const directory of homeProjectDirectories(result)) void openFolder(directory, { initEmpty: true })
      },
    })

  const stepThread = (offset: 1 | -1) => {
    const list = visibleThreads()
    if (list.length === 0) return
    const index = list.findIndex((item) => item.id === activeSessionID())
    const next = index === -1 ? (offset === 1 ? list[0] : list.at(-1)) : list[index + offset]
    if (next) openThread(next)
  }

  const stepProject = (offset: 1 | -1) => {
    const list = projects()
    if (list.length === 0) return
    const index = list.findIndex((project) => project.id === currentProject()?.id)
    const next = index === -1 ? list[0] : list[(index + offset + list.length) % list.length]
    if (!next) return
    setState("current", next.id)
    setState("expanded", next.id, true)
    const latest = groups().projects.find((group) => group.project.id === next.id)?.threads[0]
    if (latest) openThread(latest.session)
    else newThread(next)
  }

  command.register("sidebar", () => [
    {
      id: "sidebar.undo",
      title: language.t("secondBrain.command.undo"),
      category: language.t("command.category.view"),
      keybind: "mod+z",
      // Only while an undo toast is open, and never in place of a text field's own undo.
      disabled: local.undoPending === 0,
      when: outsideEditable,
      onSelect: () => undo.undoLatest(),
    },
    {
      id: "session.new",
      title: language.t("command.session.new"),
      category: language.t("command.category.session"),
      keybind: "mod+n",
      slash: "new",
      onSelect: () => newThread(),
    },
    {
      id: "project.open",
      title: language.t("secondBrain.command.openFolder"),
      category: language.t("command.category.project"),
      keybind: "mod+shift+n",
      disabled: !server.current,
      onSelect: chooseFolder,
    },
    {
      id: "sidebar.toggle",
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      onSelect: () => layout.sidebar.toggle(),
    },
    {
      id: "session.previous",
      title: language.t("command.session.previous"),
      category: language.t("command.category.session"),
      keybind: "alt+arrowup",
      onSelect: () => stepThread(-1),
    },
    {
      id: "session.next",
      title: language.t("command.session.next"),
      category: language.t("command.category.session"),
      keybind: "alt+arrowdown",
      onSelect: () => stepThread(1),
    },
    {
      id: "project.previous",
      title: language.t("command.project.previous"),
      category: language.t("command.category.project"),
      keybind: "mod+shift+[,mod+shift+{",
      onSelect: () => stepProject(-1),
    },
    {
      id: "project.next",
      title: language.t("command.project.next"),
      category: language.t("command.category.project"),
      keybind: "mod+shift+],mod+shift+}",
      onSelect: () => stepProject(1),
    },
  ])

  // tenon://open-project and tenon://new-session, formerly handled by the legacy layout.
  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return
    for (const directory of collectOpenProjectDeepLinks(urls)) void openFolder(directory)
    for (const link of collectNewSessionDeepLinks(urls)) {
      layout.projects.open(link.directory)
      const project = projectForDirectory(projects(), link.directory)
      void drafts.create(
        { server: server.key, directory: project?.threadDirectory ?? link.directory, projectID: project?.id },
        link.prompt,
      )
    }
  }
  onMount(() => {
    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, ((event: CustomEvent<{ urls?: string[] }>) => {
      const urls = event.detail?.urls ?? []
      if (urls.length > 0) handleDeepLinks(urls)
    }) as EventListener)
  })

  return {
    location,
    brainDirectory,
    projects,
    groups,
    loading: () => projectsQuery.isLoading,
    activeSessionID,
    activeDraftID: () => activeDraft()?.draftID,
    activeProjectID,
    expanded,
    toggleExpanded,
    working: (sessionID: string) => serverSync().session.data.session_working(sessionID),
    openThread,
    newThread,
    newBrainThread,
    renameThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
    setThreadPinned,
    listArchivedThreads,
    forkThread,
    openProjectCard,
    archiveProject,
    chooseFolder,
  }
}

export type SidebarController = ReturnType<typeof createSidebarController>
