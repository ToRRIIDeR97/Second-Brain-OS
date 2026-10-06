const STORE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Renderer-supplied store names become file names under userData. Restrict them
// to single, path-safe names: no separators, no leading dots, no ".." and no
// Windows drive prefixes (issue #24). Main-process callers such as the Tauri
// migration are not renderer-controlled and are not routed through this check.
export function isValidStoreName(name: string) {
  return STORE_NAME_PATTERN.test(name)
}

export function assertStoreName(name: string) {
  if (!isValidStoreName(name)) throw new Error("Invalid store name")
}