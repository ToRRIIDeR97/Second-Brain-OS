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
    const current = input as Session & Partial<HarnessSession>
    return {
      ...input,
      harnessInstanceID: current.harnessInstanceID ?? Harness.OpenCode,
      harnessModel: current.harnessModel,
      harnessRevision: current.harnessRevision,
    }
  }
  const current = input as SessionInfo & {
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
    revert: input.revert && {
      messageID: input.revert.messageID,
      partID: input.revert.partID,
      snapshot: input.revert.snapshot,
    },
  } as HarnessSession
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
