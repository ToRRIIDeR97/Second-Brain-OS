import type { AssistantMessage } from "@opencode-ai/sdk/v2/client"
import type { ProjectThreads } from "@/features/second-brain/client"
import { isWithinDirectory, projectForDirectory } from "@/features/second-brain/sidebar-threads"
import { pathKey } from "@/utils/path-key"

export type ThreadProject =
  | { kind: "project"; entry: ProjectThreads }
  /** Inside the selected workspace but outside every Project: the sidebar's General group. */
  | { kind: "general" }
  /** Outside the selected workspace, named after the open workspace (or folder) that holds it. */
  | { kind: "folder"; name: string }

/**
 * The Project a thread runs in, matched as the sidebar groups threads: the deepest active Project folder
 * holding the thread directory, else General when the thread runs inside the selected workspace.
 */
export function threadProject(input: {
  entries: readonly ProjectThreads[]
  workspaceDirectory: string | undefined
  workspaces: readonly { worktree: string; name?: string }[]
  directory: string | undefined
}): ThreadProject | undefined {
  const directory = input.directory
  if (!directory) return
  const project = projectForDirectory(
    input.entries
      .filter((entry) => entry.project.status === "active")
      .map((entry) => ({ id: entry.project.id, threadDirectory: entry.threadDirectory, entry })),
    directory,
  )
  if (project) return { kind: "project", entry: project.entry }
  if (input.workspaceDirectory && isWithinDirectory(input.workspaceDirectory, directory)) return { kind: "general" }
  const workspace = input.workspaces
    .filter((item) => isWithinDirectory(item.worktree, directory))
    .sort((a, b) => pathKey(b.worktree).length - pathKey(a.worktree).length)[0]
  return { kind: "folder", name: workspace?.name || folderName(workspace?.worktree ?? directory) }
}

/** The last response's tokens that make up the context total; parts the harness did not report are left out. */
export function contextTokenRows(tokens: AssistantMessage["tokens"]) {
  return (
    [
      { key: "input", value: tokens.input },
      { key: "cacheRead", value: tokens.cache.read },
      { key: "cacheWrite", value: tokens.cache.write },
      { key: "output", value: tokens.output },
      { key: "reasoning", value: tokens.reasoning },
    ] as const
  ).filter((row) => row.value > 0)
}

/** An instructions file path as shown in the strip: relative to the workspace folder when inside it. */
export function instructionsLabel(path: string, workspaceDirectory: string | undefined) {
  if (!workspaceDirectory || !isWithinDirectory(workspaceDirectory, path)) return path
  return pathKey(path).slice(pathKey(workspaceDirectory).length).replace(/^\//, "")
}

const folderName = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() || directory
