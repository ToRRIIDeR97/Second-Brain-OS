export * as LegacyStorage from "./legacy-storage"

import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"

export interface Root {
  readonly from: string
  readonly to: string
  /** Top-level entries of `from` that are not copied: rebuildable caches and path-bound state. */
  readonly skip: ReadonlyArray<string>
}

export type Result = "copied" | "done" | "absent"

/** Written last, so an interrupted copy is resumed on the next start. */
export const marker = ".legacy-storage-migrated"

/**
 * One-time copy of Tenon Workbench's files out of the `opencode` XDG folders it used to share with
 * upstream OpenCode. The legacy folders are never modified: upstream OpenCode keeps using them and an
 * older Tenon Workbench build can still read them.
 *
 * Completion is recorded by a marker file, not by the target folder existing: tests and early startup
 * code may create empty target folders first. Files are copied into a temporary sibling and moved into
 * place, and a file already in the target always wins over the legacy copy.
 */
export function migrate(roots: ReadonlyArray<Root>) {
  return Promise.all(roots.map(copyRoot))
}

async function copyRoot(root: Root): Promise<Result> {
  if (await exists(path.join(root.to, marker))) return "done"
  // A fresh install is marked too, so a later upstream OpenCode install is never imported.
  if (!(await exists(root.from))) return finish(root, "absent")
  const temp = `${root.to}.migrating-${randomUUID()}`
  const skip = new Set(root.skip)
  // A symlinked legacy root (dotfile managers do this) must be copied by content, not as a link back
  // into the shared folder.
  const from = await fs.realpath(root.from)
  await fs.mkdir(path.dirname(root.to), { recursive: true })
  try {
    await fs.cp(from, temp, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => {
        const relative = path.relative(from, source)
        return !skip.has(relative.split(path.sep)[0]) && !relative.endsWith(".tmp")
      },
    })
    // The whole folder moves at once when the target does not exist yet; otherwise merge file by file.
    const moved = await fs.rename(temp, root.to).then(
      () => true,
      () => false,
    )
    if (!moved) await moveMissing(temp, root.to)
    return finish(root, "copied")
  } catch (error) {
    throw new Error(
      `Could not copy Tenon Workbench data from ${root.from} to ${root.to}. The original folder is unchanged.`,
      { cause: error },
    )
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

async function finish(root: Root, result: Result) {
  await fs.mkdir(root.to, { recursive: true })
  await fs.writeFile(path.join(root.to, marker), `${JSON.stringify({ from: root.from, result })}\n`)
  return result
}

// Moves entries the target lacks; each rename is atomic, and existing files are left alone.
async function moveMissing(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true })
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (!(await exists(to))) {
      await fs.rename(from, to).catch(() => undefined)
      continue
    }
    if (entry.isDirectory() && (await fs.stat(to)).isDirectory()) await moveMissing(from, to)
  }
}

function exists(target: string) {
  return fs.lstat(target).then(
    () => true,
    () => false,
  )
}
