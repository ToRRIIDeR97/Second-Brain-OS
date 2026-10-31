import path from "path"
import { realpathSync } from "fs"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { containsPath } from "../project/instance-context"
import { FSUtil } from "@opencode-ai/core/fs-util"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return false

  if (options?.bypass) return false

  const ins = yield* InstanceState.context
  const written = process.platform === "win32" ? FSUtil.normalizePath(target) : target
  const real = realTarget(written)
  const roots = {
    ...ins,
    directory: realTarget(ins.directory),
    worktree: ins.worktree === "/" ? ins.worktree : realTarget(ins.worktree),
  }
  if (containsPath(real, roots)) return false
  // Rules name paths as the user writes them, so ask with that path; only a path that looks internal
  // but resolves outside the project is shown as its real target.
  const full = containsPath(written, ins) ? real : written

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
  return true
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options))
}

/**
 * The nearest existing ancestor's real path plus the part that doesn't exist yet, so a new file
 * under a symlinked or junctioned folder is checked where it will actually be written.
 */
function realTarget(target: string) {
  const tail: string[] = []
  let current = path.resolve(target)
  while (true) {
    try {
      return path.join(realpathSync.native(current), ...tail)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(target)
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}
