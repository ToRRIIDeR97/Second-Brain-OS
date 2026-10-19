// Renderer-supplied store names become file names under userData. Only the
// renderer's own stores are addressable: the legacy "default.dat" and the
// "opencode.<scope>.dat" files built by app/src/utils/persist.ts. Main-owned
// files (opencode.settings, opencode.updater, second-brain.google, window
// state, Chromium Preferences) never end in ".dat" and are rejected, as are
// separators, leading dots and Windows drive prefixes (issue #24).
const STORE_NAME_PATTERN = /^(default|opencode\.[A-Za-z0-9][A-Za-z0-9._-]*)\.dat$/

export function isValidStoreName(name: unknown) {
  return typeof name === "string" && STORE_NAME_PATTERN.test(name)
}

export function assertStoreName(name: unknown) {
  if (!isValidStoreName(name)) throw new Error("Invalid store name")
}
