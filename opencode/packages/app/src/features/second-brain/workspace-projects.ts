type OpenWorkspace = { id?: string; worktree: string }

/**
 * Tracks Workspaces opened during this app session so each gets a linked Project.
 * Workspaces already open when tracking starts are left to the server-side
 * migration, which only covers folders that have threads.
 */
export function createWorkspaceProjectTracker() {
  const state = { baseline: undefined as Set<string> | undefined, handled: new Set<string>() }
  return {
    /** Return newly opened Workspaces (with a known id) that still need a Project. */
    next(input: { workspaces: ReadonlyArray<OpenWorkspace>; brainDirectory?: string }) {
      if (!state.baseline) {
        state.baseline = new Set(input.workspaces.map((workspace) => workspace.worktree))
        return []
      }
      const baseline = state.baseline
      const brain = input.brainDirectory ?? input.workspaces.find((workspace) => baseline.has(workspace.worktree))?.worktree
      const pending = input.workspaces.filter(
        (workspace): workspace is { id: string; worktree: string } =>
          !!workspace.id &&
          workspace.id !== "global" &&
          workspace.worktree !== brain &&
          !baseline.has(workspace.worktree) &&
          !state.handled.has(workspace.worktree),
      )
      pending.forEach((workspace) => state.handled.add(workspace.worktree))
      return pending.length > 0 && brain ? pending.map((workspace) => ({ ...workspace, brainDirectory: brain })) : []
    },
  }
}
