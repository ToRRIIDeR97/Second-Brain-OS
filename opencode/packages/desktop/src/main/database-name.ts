import type { Channel } from "./constants"

/**
 * The server database file for an installed build, by the desktop channel. Without it the server names its database
 * after the channel it was built with, which falls back to the git branch of the build, so every build from another
 * branch opened an empty thread list. Unpackaged `bun run dev` runs keep that per-branch database, so they never
 * write to an installed build's threads.
 */
export function stableDatabaseName(channel: Channel, packaged: boolean) {
  if (!packaged) return undefined
  return channel === "prod" ? "opencode.db" : `opencode-${channel}.db`
}
