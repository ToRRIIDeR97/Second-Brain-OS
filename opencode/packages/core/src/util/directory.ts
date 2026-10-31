import path from "node:path"

// One spelling per folder, so caches keyed by directory don't load the same
// folder twice. On Windows "C:/a" and "c:\a\" both become "C:\a".
export function canonicalDirectory(input: string, platform: NodeJS.Platform = process.platform) {
  if (platform !== "win32") return path.posix.resolve(input)
  const resolved = path.win32.resolve(input)
  return /^[a-z]:/.test(resolved) ? resolved[0]!.toUpperCase() + resolved.slice(1) : resolved
}
