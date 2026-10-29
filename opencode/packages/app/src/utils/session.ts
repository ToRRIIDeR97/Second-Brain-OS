import type { SessionApi, SessionInfo, SessionListInput } from "@opencode-ai/client/promise"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@opencode-ai/schema/harness"
import { withTimestampedFallback } from "./session-title"

export type HarnessSession = Session & {
  harnessInstanceID?: Harness.InstanceID
  harnessModel?: Harness.ModelSelection
  harnessRevision?: number
}

export function normalizeSessionInfo(input: SessionInfo | Session): HarnessSession {
  if (!("location" in input)) {
    // v1 `session.updated` events carry the harness only inside `metadata`.
    const current = input as Session & Partial<HarnessSession>
    const metadata = input.metadata ?? {}
    return {
      ...input,
      harnessInstanceID: current.harnessInstanceID ?? metadataHarness(metadata.harnessInstanceID) ?? Harness.OpenCode,
      harnessModel: current.harnessModel ?? metadataModel(metadata.harnessModel),
      harnessRevision:
        current.harnessRevision ??
        (typeof metadata.harnessRevision === "number" ? metadata.harnessRevision : undefined),
    }
  }
  // The vendored client predates these fields; `time.pinned` mirrors `metadata.pinned` on the legacy shape.
  const current = input as SessionInfo & {
    time: SessionInfo["time"] & { pinned?: number }
    harnessInstanceID?: string
    harnessModel?: Harness.ModelSelection
    harnessRevision?: number
  }
  return {
    id: input.id,
    slug: input.id,
    projectID: input.projectID,
    workspaceID: input.location.workspaceID,
    directory: input.location.directory,
    path: input.subpath,
    parentID: input.parentID,
    cost: input.cost,
    tokens: input.tokens,
    title: withTimestampedFallback(input),
    agent: input.agent,
    model: input.model,
    harnessInstanceID: current.harnessInstanceID
      ? Harness.InstanceID.make(current.harnessInstanceID)
      : Harness.OpenCode,
    harnessModel: current.harnessModel,
    harnessRevision: current.harnessRevision,
    version: "",
    time: input.time,
    metadata: current.time.pinned === undefined ? undefined : { pinned: current.time.pinned },
    revert: input.revert && {
      messageID: input.revert.messageID,
      partID: input.revert.partID,
      snapshot: input.revert.snapshot,
      // empty when the rewind left files untouched ("Messages only")
      diff: current.revert?.files?.map((file) => file.patch).join(""),
    },
  } as HarnessSession
}

function metadataHarness(value: unknown) {
  return typeof value === "string" && value ? Harness.InstanceID.make(value) : undefined
}

function metadataModel(value: unknown): Harness.ModelSelection | undefined {
  if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string") return undefined
  const text = (key: string) => {
    const field: unknown = Reflect.get(value, key)
    return typeof field === "string" ? field : undefined
  }
  return { id: value.id, reasoningEffort: text("reasoningEffort"), serviceTier: text("serviceTier") }
}

// Whether moving a staged rollback's boundary restores files: a messages-only rewind (empty diff) never
// does; undefined leaves the choice to the server.
export function revertRestoresFiles(revert: { diff?: string } | undefined) {
  return revert?.diff === undefined ? undefined : revert.diff.length > 0
}

// Pin time in epoch ms, stored by the server in `metadata.pinned`.
export function sessionPinnedAt(session: Pick<Session, "metadata">) {
  const pinned = session.metadata?.pinned
  return typeof pinned === "number" ? pinned : undefined
}

export async function listAllSessions(api: Pick<SessionApi, "list">, input: Omit<SessionListInput, "cursor">) {
  const load = async (cursor?: string): Promise<HarnessSession[]> => {
    const result = await api.list({ ...input, limit: input.limit ?? 100, cursor })
    const sessions = result.data.map(normalizeSessionInfo)
    if (result.data.length === 0 || !result.cursor.next) return sessions
    return [...sessions, ...(await load(result.cursor.next))]
  }
  return load()
}
