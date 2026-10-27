import path from "node:path"
import { DEEP_LINK_SCHEME } from "./constants"

export type DeepLink =
  | { kind: "open-project"; directory: string; url: string }
  | { kind: "new-session"; directory: string; prompt?: string; url: string }

const promptLimit = 16_000

/**
 * Validate a `tenon://` link before anything acts on it. Only `open-project` and
 * `new-session` exist, and their directory must be an existing local absolute folder:
 * UNC (`\\host\share`), protocol-relative (`//host/x`), `file:` and relative paths are
 * refused, as is any `..` segment. The returned `url` is rebuilt from the checked
 * values, so the renderer never sees extra parameters.
 */
export function parseDeepLink(value: string, isDirectory: (directory: string) => boolean): DeepLink | undefined {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return undefined
  if (url.hostname !== "open-project" && url.hostname !== "new-session") return undefined
  const directory = url.searchParams.get("directory")
  if (!directory || !isLocalDirectory(directory, isDirectory)) return undefined
  if (url.hostname === "open-project") {
    return { kind: "open-project", directory, url: rebuild("open-project", { directory }) }
  }
  const prompt = url.searchParams.get("prompt")?.slice(0, promptLimit) || undefined
  return {
    kind: "new-session",
    directory,
    ...(prompt ? { prompt } : {}),
    url: rebuild("new-session", prompt ? { directory, prompt } : { directory }),
  }
}

function isLocalDirectory(directory: string, isDirectory: (directory: string) => boolean) {
  if (directory.startsWith("\\\\") || directory.startsWith("//")) return false
  if (/^file:/i.test(directory)) return false
  if (!path.isAbsolute(directory)) return false
  if (directory.split(/[\\/]/).includes("..")) return false
  return isDirectory(directory)
}

function rebuild(host: string, params: Record<string, string>) {
  return `${DEEP_LINK_SCHEME}://${host}?${new URLSearchParams(params).toString()}`
}

// Deep links go straight to a renderer that is already listening. Otherwise
// they wait for the next renderer to consume them while it loads. A link that
// was delivered is never queued, so it can't replay in a later window or after
// a reload.
export function createDeepLinkQueue() {
  const pending: string[] = []
  const listening = new Set<number>()

  return {
    emit(urls: string[], target?: { id: number; send: (urls: string[]) => void }) {
      if (urls.length === 0) return
      if (target && listening.has(target.id)) return target.send(urls)
      pending.push(...urls)
    },
    // Called by a renderer once it has subscribed to live deep links.
    consume(id: number) {
      listening.add(id)
      return pending.splice(0)
    },
    // Called when a renderer starts loading again or is destroyed.
    forget(id: number) {
      listening.delete(id)
    },
  }
}
