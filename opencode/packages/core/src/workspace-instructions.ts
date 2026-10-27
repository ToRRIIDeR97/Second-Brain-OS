export * as WorkspaceInstructions from "./workspace-instructions"

import { Effect } from "effect"
import path from "path"
import { FSUtil } from "./fs-util"

/** Marks a Tenon Workbench workspace root and lists the project folders linked from elsewhere. */
export const manifestPath = path.join(".tenon", "workspace.json")

/** Rebuildable cache in the app data folder: linked project folder -> workspace root. Written by a scan. */
export const linkIndexFile = "workspace-links.json"

const file = "AGENTS.md"

/**
 * The AGENTS.md files for a session running in `directory`, or undefined when the directory
 * belongs to no Tenon workspace (callers then keep their usual lookup).
 *
 * Inside a workspace a project's own AGENTS.md replaces the workspace default: the nearest
 * AGENTS.md between `directory` and the project root wins, otherwise `<workspace>/AGENTS.md`.
 */
export const resolve = Effect.fn("WorkspaceInstructions.resolve")(function* (directory: string, dataDir: string) {
  const fs = yield* FSUtil.Service
  const start = path.resolve(directory)
  const found = yield* workspaceFor(start, dataDir)
  if (!found) return undefined
  for (const dir of found.search) {
    if (yield* contained(path.join(dir, file), found.base)) return [path.join(dir, file)]
  }
  const fallback = path.join(found.root, file)
  return (yield* contained(fallback, found.root)) ? [fallback] : []
})

/**
 * Whether `candidate` is a file whose real path stays inside the real `base` folder. A symlinked
 * AGENTS.md pointing elsewhere would otherwise inject an arbitrary file into every session.
 */
const contained = Effect.fnUntraced(function* (candidate: string, base: string) {
  const fs = yield* FSUtil.Service
  if (!(yield* fs.isFile(candidate))) return false
  const real = yield* fs.realPath(candidate).pipe(Effect.orElseSucceed(() => undefined))
  const root = yield* fs.realPath(base).pipe(Effect.orElseSucceed(() => undefined))
  return real !== undefined && root !== undefined && FSUtil.contains(root, real)
})

/**
 * The workspace root for `start` plus the folders to search for a project AGENTS.md, nearest
 * first: up to (not including) the root, or up to and including a linked project folder.
 */
export const workspaceFor = Effect.fnUntraced(function* (start: string, dataDir: string) {
  const fs = yield* FSUtil.Service
  const chain = ancestors(start)
  for (const [index, dir] of chain.entries()) {
    if (yield* fs.isFile(path.join(dir, manifestPath))) return { root: dir, base: dir, search: chain.slice(0, index) }
  }
  const index = yield* fs.readJson(path.join(dataDir, linkIndexFile)).pipe(Effect.orElseSucceed(() => undefined))
  if (typeof index !== "object" || index === null) return undefined
  const match = Object.entries(index)
    .filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && isWithin(path.resolve(entry[0]), start),
    )
    .sort((a, b) => b[0].length - a[0].length)[0]
  if (!match) return undefined
  const folder = path.resolve(match[0])
  return { root: path.resolve(match[1]), base: folder, search: chain.slice(0, chain.indexOf(folder) + 1) }
})

/** `start` and its ancestors, nearest first. */
function ancestors(start: string) {
  const result = [start]
  while (path.dirname(result.at(-1)!) !== result.at(-1)) result.push(path.dirname(result.at(-1)!))
  return result
}

function isWithin(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
