import { pathKey } from "@/utils/path-key"
import { sessionPinnedAt } from "@/utils/session"

export type SidebarSession = {
  id: string
  parentID?: string
  directory: string
  time: { created: number; updated?: number; archived?: number }
  /** `metadata.pinned` holds the pin time in epoch ms. */
  metadata?: { [key: string]: unknown }
}

export type SidebarProject = { id: string; threadDirectory: string }

export type ThreadNode<S extends SidebarSession = SidebarSession> = { session: S; children: ThreadNode<S>[] }

export type SidebarGroups<P extends SidebarProject, S extends SidebarSession> = {
  projects: Array<{ project: P; threads: ThreadNode<S>[] }>
  /** Threads that run in the Brain folder itself and belong to no Project. */
  brain: ThreadNode<S>[]
  /** Threads in any other folder (non-git folders, unlinked Workspaces). */
  other: ThreadNode<S>[]
}

const recent = (session: SidebarSession) => session.time.updated ?? session.time.created

/** Pinned roots first (latest pin first), then the rest by last update. */
const compareRoots = (a: SidebarSession, b: SidebarSession) =>
  (sessionPinnedAt(b) ?? 0) - (sessionPinnedAt(a) ?? 0) || recent(b) - recent(a)

/**
 * Nest child threads under their parent. Pinned roots come first, then the newest; children oldest first.
 * A child whose parent is not in the list is shown as a root so it never disappears.
 */
export function buildThreadTree<S extends SidebarSession>(sessions: readonly S[]): ThreadNode<S>[] {
  const unique = [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
  const nodes = new Map(unique.map((session) => [session.id, { session, children: [] as ThreadNode<S>[] }]))
  const roots: ThreadNode<S>[] = []
  for (const node of nodes.values()) {
    const parent = node.session.parentID ? nodes.get(node.session.parentID) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const sortChildren = (node: ThreadNode<S>) => {
    node.children.sort((a, b) => a.session.time.created - b.session.time.created)
    node.children.forEach(sortChildren)
  }
  roots.forEach(sortChildren)
  return roots.sort((a, b) => compareRoots(a.session, b.session))
}

/** The Project whose thread directory is exactly `directory`. */
export function projectForDirectory<P extends SidebarProject>(projects: readonly P[], directory: string | undefined) {
  if (!directory) return
  const key = pathKey(directory)
  return projects.find((project) => pathKey(project.threadDirectory) === key)
}

/**
 * Split threads into Project groups, the Brain group and "Other threads".
 * Matching is by exact thread directory, so Projects that share a repository
 * through `projects/<id>/` folders don't show each other's threads.
 */
export function groupSidebarThreads<P extends SidebarProject, S extends SidebarSession>(input: {
  projects: readonly P[]
  brainDirectory?: string
  sessions: readonly S[]
}): SidebarGroups<P, S> {
  const live = input.sessions.filter((session) => !session.time.archived)
  const byProject = new Map<string, S[]>()
  const brain: S[] = []
  const other: S[] = []
  const brainKey = input.brainDirectory ? pathKey(input.brainDirectory) : undefined
  // Reversed so the first Project for a directory wins, as in `projectForDirectory`.
  const projectByKey = new Map(
    [...input.projects].reverse().map((project) => [pathKey(project.threadDirectory), project] as const),
  )
  for (const session of live) {
    const sessionKey = pathKey(session.directory)
    const project = projectByKey.get(sessionKey)
    if (project) {
      const list = byProject.get(project.id) ?? []
      list.push(session)
      byProject.set(project.id, list)
      continue
    }
    if (brainKey && sessionKey === brainKey) brain.push(session)
    else other.push(session)
  }
  return {
    projects: input.projects.map((project) => ({ project, threads: buildThreadTree(byProject.get(project.id) ?? []) })),
    brain: buildThreadTree(brain),
    other: buildThreadTree(other),
  }
}

/**
 * Combine the loaded directory lists with the recent-session index. A directory list
 * contributes only threads that run in that directory: server events for a thread
 * reach only its own directory's list, so a copy held by another list (e.g. the Brain
 * folder's list of its whole OpenCode project) can be stale and must not win.
 */
export function mergeSidebarSessions<S extends SidebarSession>(
  lists: ReadonlyArray<{ directory: string; sessions: readonly S[] }>,
  index: readonly S[],
): S[] {
  const owned = lists.flatMap((list) => {
    const key = pathKey(list.directory)
    return list.sessions.filter((session) => pathKey(session.directory) === key)
  })
  return [...owned, ...index]
}

/** Visible threads in sidebar order, for previous/next thread navigation. */
export function flattenThreads<S extends SidebarSession>(nodes: readonly ThreadNode<S>[]): S[] {
  return nodes.flatMap((node) => [node.session, ...flattenThreads(node.children)])
}
