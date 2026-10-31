import path from "path"

/**
 * True for the home folder or a filesystem root: folders far too large to snapshot or watch whole. A thread folder
 * outside any git repository gets snapshots and a watcher only when it is narrower than these.
 */
export function isBroadFolder(directory: string, home: string) {
  const windows = /^[A-Za-z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
  const resolve = windows ? path.win32.resolve : path.posix.resolve
  const parse = windows ? path.win32.parse : path.posix.parse
  const target = resolve(directory)
  const compare = (value: string) => (windows ? value.toLowerCase() : value)
  return compare(target) === compare(parse(target).root) || compare(target) === compare(resolve(home))
}
