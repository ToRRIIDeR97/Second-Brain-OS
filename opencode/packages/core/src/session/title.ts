export * as SessionTitle from "./title"

import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionV1 } from "../v1/session"
import { SessionMessage } from "./message"
import { SessionTable } from "./sql"

const DEFAULT_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const MAX_LENGTH = 100

/** True for the placeholder title the store gives a new Session. */
export function isDefault(title: string) {
  return DEFAULT_TITLE.test(title)
}

/** First non-empty line of a model reply without reasoning blocks, capped at 100 characters. */
export function clean(text: string) {
  const line = text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (!line) return undefined
  return line.length > MAX_LENGTH ? line.substring(0, MAX_LENGTH - 3) + "..." : line
}

/** Only a top-level, still-default Session is titled, and only after its first user message. */
export function eligible(input: { parentID?: string; title: string; userMessages: number }) {
  return !input.parentID && isDefault(input.title) && input.userMessages === 1
}

/** The prompt sent to the title agent: the first user message's text plus attached file names. */
export function prompt(message: SessionMessage.User) {
  const files = (message.files ?? []).map((file) => file.name ?? file.uri)
  return [
    "Generate a title for this conversation:\n",
    message.text,
    ...(files.length ? [`\nFiles: ${files.join(", ")}`] : []),
  ].join("")
}

/** The stored Session as a V1 snapshot carrying a new title, for `SessionV1.Event.Updated`. */
export function renamed(row: typeof SessionTable.$inferSelect, title: string): SessionV1.SessionInfo {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: row.model.variant,
        }
      : undefined,
    version: row.version,
    summary,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
    },
    share: row.share_url ? { url: row.share_url } : undefined,
    metadata: row.metadata ?? undefined,
    revert: row.revert
      ? {
          messageID: SessionV1.MessageID.make(row.revert.messageID),
          partID: row.revert.partID ? SessionV1.PartID.make(row.revert.partID) : undefined,
          snapshot: row.revert.snapshot,
          diff: row.revert.diff,
        }
      : undefined,
    permission: row.permission ? [...row.permission] : undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}
