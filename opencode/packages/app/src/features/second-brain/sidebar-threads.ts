import { pathKey } from "@/utils/path-key"

export type SidebarSession = {
  id: string
  parentID?: string
  directory: string
  time: { created: number; updated?: number; archived?: number }
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

/**
 * Nest child threads under their parent. Roots are newest first; children oldest first.
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
  return roots.sort((a, b) => recent(b.session) - recent(a.session))
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
  for (const session of live) {
    const project = projectForDirectory(input.projects, session.directory)
    if (project) {
      const list = byProject.get(project.id) ?? []
      list.push(session)
      byProject.set(project.id, list)
      continue
    }
    if (brainKey && pathKey(session.directory) === brainKey) brain.push(session)
    else other.push(session)
  }
  return {
    projects: input.projects.map((project) => ({ project, threads: buildThreadTree(byProject.get(project.id) ?? []) })),
    brain: buildThreadTree(brain),
    other: buildThreadTree(other),
  }
}

/** Visible threads in sidebar order, for previous/next thread navigation. */
export function flattenThreads<S extends SidebarSession>(nodes: readonly ThreadNode<S>[]): S[] {
  return nodes.flatMap((node) => [node.session, ...flattenThreads(node.children)])
}
