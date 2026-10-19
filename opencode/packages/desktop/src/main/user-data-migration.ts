import { randomUUID } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

/** Written last in the new userData folder, so an interrupted copy is resumed on the next start. */
export const marker = ".user-data-migrated"

// Chromium caches, crash dumps, logs, per-version CLI installs and process locks are rebuilt on start.
const skip = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Crashpad",
  "logs",
  "cli",
  "DevToolsActivePort",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
])

/**
 * One-time copy of Electron userData from the app ID Tenon Workbench used to share with upstream OpenCode
 * Desktop. Synchronous because it must finish before the stores open. It runs after the single-instance
 * lock, which may already have created Electron's Singleton* files in the new folder (they are never copied).
 * The old folder is never modified. A fresh install is marked too, so a folder that appears later is
 * never imported.
 */
export function migrateUserData(from: string | undefined, to: string) {
  if (existsSync(join(to, marker))) return "done"
  if (!from || !existsSync(from)) return finish(from, to, "absent")
  const source = realpathSync(from)
  const temp = `${to}.migrating-${randomUUID()}`
  mkdirSync(dirname(to), { recursive: true })
  try {
    cpSync(source, temp, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => !skip.has(relative(source, path).split(sep)[0]),
    })
    if (!rename(temp, to)) moveMissing(temp, to)
    return finish(from, to, "copied")
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function finish(from: string | undefined, to: string, result: "copied" | "absent") {
  mkdirSync(to, { recursive: true })
  writeFileSync(join(to, marker), `${JSON.stringify({ from, result })}\n`)
  return result
}

// Moves entries the target lacks; files already in the target win.
function moveMissing(source: string, target: string) {
  mkdirSync(target, { recursive: true })
  readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (!existsSync(to)) return void rename(from, to)
    if (entry.isDirectory() && statSync(to).isDirectory()) moveMissing(from, to)
  })
}

function rename(from: string, to: string) {
  try {
    renameSync(from, to)
    return true
  } catch {
    return false
  }
}
