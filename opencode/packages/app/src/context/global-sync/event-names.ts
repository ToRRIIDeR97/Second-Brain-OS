// Event names this server emits (see @opencode-ai/schema session-event.ts). The vendored upstream
// client still types the older `session.moved` and `session.revert.*` names; those stay handled as
// harmless aliases.
export const SERVER_EVENT_NAMES = {
  connected: "server.connected",
  disposed: "global.disposed",
  moved: "session.next.moved",
  revert: ["session.next.revert.staged", "session.next.revert.cleared", "session.next.revert.committed"],
} as const

const LEGACY_REVERT = new Set(["session.revert.staged", "session.revert.cleared", "session.revert.committed"])

export function isSessionMovedEvent(type: string | undefined) {
  return type === SERVER_EVENT_NAMES.moved || type === "session.moved"
}

export function isSessionRevertEvent(type: string | undefined) {
  if (!type) return false
  return (SERVER_EVENT_NAMES.revert as readonly string[]).includes(type) || LEGACY_REVERT.has(type)
}

// `session.next.moved` carries `subdirectory`; the legacy shape carries `subpath` and `projectID`.
export type SessionMovedData = {
  sessionID: string
  location: { directory: string; workspaceID?: string }
  projectID?: string
  subpath?: string
  subdirectory?: string
}

export function sessionMovedPath(data: SessionMovedData) {
  return data.subpath ?? data.subdirectory
}
