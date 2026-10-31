import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import {
  OpenCode,
  type OpenCodeClient,
  type SessionCreateInput,
  type SessionInfo,
  type SessionPromptInput,
} from "@opencode-ai/client/promise"
import type { VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { Harness } from "@opencode-ai/schema/harness"
import { Harness as HarnessSchema } from "@opencode-ai/schema/harness"
import { Location } from "@opencode-ai/schema/location"
import { Skill as SkillSchema } from "@opencode-ai/schema/skill"
import { Schema } from "effect"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

export type ServerApi = OpenCodeClient

export type HarnessSessionCreateInput = SessionCreateInput & {
  readonly harnessInstanceID?: Harness.InstanceID
  readonly harnessModel?: Harness.ModelSelection
}

export class SessionCreateError extends Error {
  readonly status?: number

  constructor(status?: number) {
    super()
    this.name = "SessionCreateError"
    this.status = status
  }
}

const decodeHarnessResponse = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.Instance)))

export function fallbackHarnesses(): ReadonlyArray<Harness.Instance> {
  return [
    HarnessSchema.Instance.make({
      id: HarnessSchema.OpenCode,
      driver: HarnessSchema.OpenCodeDriver,
      name: "Default agent",
      status: "available",
      models: [],
    }),
    HarnessSchema.Instance.make({
      id: HarnessSchema.Codex,
      driver: HarnessSchema.CodexDriver,
      name: "Codex",
      status: "unavailable",
      models: [],
    }),
    HarnessSchema.Instance.make({
      id: HarnessSchema.OpenCodeAcp,
      driver: HarnessSchema.AcpDriver,
      name: "OpenCode",
      status: "unavailable",
      models: [],
    }),
    HarnessSchema.Instance.make({
      id: HarnessSchema.ClaudeCode,
      driver: HarnessSchema.AcpDriver,
      name: "Claude Code",
      status: "unavailable",
      models: [],
    }),
  ]
}

export async function listHarnessesForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  directory: string,
) {
  const url = new URL(`${input.server.url.replace(/\/+$/, "")}/api/harness`)
  url.searchParams.set("location[directory]", directory)
  const response = await (input.fetch ?? globalThis.fetch)(url, {
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
  if (!response.ok) throw new Error(`Harness availability check failed (${response.status}).`)
  return decodeHarnessResponse(await response.json()).data
}

// The last list each server reported per folder. A composer that opens shows it at once while its own
// check runs, so opening a thread doesn't wait on the server starting every harness CLI. Every check
// replaces it; a failed check is never kept.
const recentHarnesses = new Map<string, ReadonlyArray<HarnessSchema.Instance>>()
// The persisted list (harness-controller.ts) uses the same shape with the connection key in place of the URL.
export const recentHarnessKey = (server: string, directory: string) => `${server}\n${directory}`

// Availability doesn't depend on the folder, so a folder opened for the first time uses the server's
// latest list from any folder.
const latestHarnesses = new Map<string, ReadonlyArray<HarnessSchema.Instance>>()

export function rememberedHarnesses(url: string, directory: string) {
  return recentHarnesses.get(recentHarnessKey(url, directory)) ?? latestHarnesses.get(url)
}

/**
 * Lists the harnesses for a folder and remembers the answer, also through `keep` (which persists it).
 * A failed check returns the fallback list and keeps nothing.
 */
export async function listHarnessesRemembered(
  input: Parameters<typeof listHarnessesForServer>[0],
  directory: string,
  keep?: (list: ReadonlyArray<HarnessSchema.Instance>) => void,
) {
  const list = await listHarnessesForServer(input, directory).catch(() => undefined)
  // A failed check keeps the last answer instead of marking every harness unavailable.
  if (!list) {
    const last = rememberedHarnesses(input.server.url, directory)
    if (last) return last
    throw new Error("Harness availability check failed.")
  }
  recentHarnesses.set(recentHarnessKey(input.server.url, directory), list)
  latestHarnesses.set(input.server.url, list)
  keep?.(list)
  return list
}

const decodeSettingsList = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.SettingsEntry)))
const decodeSettingsEntry = Schema.decodeUnknownSync(Location.response(HarnessSchema.SettingsEntry))
const decodeDiscovery = Schema.decodeUnknownSync(Location.response(HarnessSchema.Discovery))

type HarnessServer = {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}

// Settings routes return `{ reason, message }` on failure; the message is written for people.
function harnessSettingsRequest(input: HarnessServer, directory: string, route: string, init?: RequestInit) {
  return locationRequest(input, directory, `/api/harness${route}`, "Harness request failed", init)
}

// The vendored client predates some routes, so settings pages call them directly with the location query.
async function locationRequest(
  input: HarnessServer,
  directory: string,
  route: string,
  failure: string,
  init?: RequestInit,
) {
  const url = new URL(`${input.server.url.replace(/\/+$/, "")}${route}`)
  // Without a folder the server uses its own default location; harness routes don't depend on it.
  if (directory) url.searchParams.set("location[directory]", directory)
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set("content-type", "application/json")
  if (input.server.password)
    headers.set(
      "Authorization",
      `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
    )
  const response = await (input.fetch ?? globalThis.fetch)(url, { ...init, headers })
  const body: unknown = await response.json().catch(() => undefined)
  if (response.ok) return body
  const message =
    typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
      ? body.message
      : `${failure} (${response.status}).`
  throw new Error(message)
}

const decodeSkillCatalog = Schema.decodeUnknownSync(Location.response(SkillSchema.Catalog))

/** Tenon's skills and each harness's skills, read-only, for Settings → Skills. */
export async function listSkillCatalog(input: HarnessServer, directory: string) {
  return decodeSkillCatalog(await locationRequest(input, directory, "/api/skill/catalog", "Skills request failed")).data
}

const decodeSkillEnabled = Schema.decodeUnknownSync(
  Location.response(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean })),
)

const decodeSkills = Schema.decodeUnknownSync(Location.response(Schema.Array(SkillSchema.Info)))

/** Tenon's skills with their instructions; a skill chip in the composer sends them with the prompt. */
export async function listSkills(input: HarnessServer, directory: string) {
  return decodeSkills(await locationRequest(input, directory, "/api/skill", "Skills request failed")).data
}

/** Switches one of Tenon's skills on or off; harness skills can't be switched. */
export async function setSkillEnabled(input: HarnessServer, directory: string, name: string, enabled: boolean) {
  return decodeSkillEnabled(
    await locationRequest(input, directory, "/api/skill/enabled", "Skills request failed", {
      method: "POST",
      body: JSON.stringify({ name, enabled }),
    }),
  ).data
}

export async function listHarnessSettings(input: HarnessServer, directory: string) {
  return decodeSettingsList(await harnessSettingsRequest(input, directory, "/settings")).data
}

const decodeTitleAgent = Schema.decodeUnknownSync(
  Location.response(Schema.Struct({ id: Schema.optional(HarnessSchema.InstanceID) })),
)

/** The harness that titles new threads; undefined means each thread's own harness. */
export async function getTitleAgent(input: HarnessServer, directory: string) {
  return decodeTitleAgent(await harnessSettingsRequest(input, directory, "/title-agent")).data.id
}

export async function setTitleAgent(input: HarnessServer, directory: string, id: string | undefined) {
  return decodeTitleAgent(
    await harnessSettingsRequest(input, directory, "/title-agent", { method: "PUT", body: JSON.stringify({ id }) }),
  ).data.id
}

export async function discoverHarness(input: HarnessServer, directory: string, value: HarnessSchema.DiscoverInput) {
  return decodeDiscovery(
    await harnessSettingsRequest(input, directory, "/discover", { method: "POST", body: JSON.stringify(value) }),
  ).data
}

const decodeAssistantDirectory = Schema.decodeUnknownSync(
  Location.response(Schema.Struct({ directory: Schema.String })),
)

export async function harnessAssistantDirectory(input: HarnessServer, directory: string) {
  return decodeAssistantDirectory(await harnessSettingsRequest(input, directory, "/assistant-directory")).data.directory
}

const decodeVerification = Schema.decodeUnknownSync(Location.response(HarnessSchema.Verification))

export async function verifyHarness(input: HarnessServer, directory: string, value: HarnessSchema.VerifyInput) {
  return decodeVerification(
    await harnessSettingsRequest(input, directory, "/verify", { method: "POST", body: JSON.stringify(value) }),
  ).data
}

export async function addHarness(input: HarnessServer, directory: string, value: HarnessSchema.SettingsInput) {
  return decodeSettingsEntry(
    await harnessSettingsRequest(input, directory, "/registry", { method: "POST", body: JSON.stringify(value) }),
  ).data
}

export async function setHarnessEnabled(input: HarnessServer, directory: string, id: string, enabled: boolean) {
  return decodeSettingsEntry(
    await harnessSettingsRequest(input, directory, `/registry/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  ).data
}

export async function removeHarness(input: HarnessServer, directory: string, id: string) {
  await harnessSettingsRequest(input, directory, `/registry/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** Re-reads harness availability and models, for one harness or all, skipping the server's cache. */
export async function refreshHarnesses(input: HarnessServer, directory: string, id?: string) {
  return decodeHarnessResponse(
    await harnessSettingsRequest(input, directory, "/refresh", { method: "POST", body: JSON.stringify({ id }) }),
  ).data
}

const decodeSetupList = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.SetupStatus)))
const decodeSetup = Schema.decodeUnknownSync(Location.response(HarnessSchema.SetupStatus))
const decodeSignIn = Schema.decodeUnknownSync(Location.response(HarnessSchema.SignIn))
const setupPath = (id: string, action: string) => `/setup/${encodeURIComponent(id)}/${action}`

/** Install and sign-in state of the built-in external harnesses. */
export async function listHarnessSetup(input: HarnessServer, directory: string) {
  return decodeSetupList(await harnessSettingsRequest(input, directory, "/setup")).data
}

export async function installHarness(input: HarnessServer, directory: string, id: string) {
  return decodeSetup(await harnessSettingsRequest(input, directory, setupPath(id, "install"), { method: "POST" })).data
}

/** Starts a browser sign-in and returns the link to open. */
export async function signInHarness(input: HarnessServer, directory: string, id: string) {
  return decodeSignIn(await harnessSettingsRequest(input, directory, setupPath(id, "sign-in"), { method: "POST" })).data
}

export async function setHarnessApiKey(
  input: HarnessServer,
  directory: string,
  id: string,
  value: HarnessSchema.ApiKeyInput,
) {
  return decodeSetup(
    await harnessSettingsRequest(input, directory, setupPath(id, "api-key"), {
      method: "PUT",
      body: JSON.stringify(value),
    }),
  ).data
}

export async function removeHarnessApiKey(input: HarnessServer, directory: string, id: string) {
  return decodeSetup(await harnessSettingsRequest(input, directory, setupPath(id, "api-key"), { method: "DELETE" }))
    .data
}

const decodeUpdates = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.UpdateStatus)))
const decodeUpdate = Schema.decodeUnknownSync(Location.response(HarnessSchema.UpdateStatus))

export async function listHarnessUpdates(input: HarnessServer, directory: string) {
  return decodeUpdates(await harnessSettingsRequest(input, directory, "/updates")).data
}

const decodeUsage = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.UsageReport)))

/** Subscription usage limits of each enabled harness; the server caches each harness's answer for a minute. */
export async function listHarnessUsage(input: HarnessServer, directory: string) {
  return decodeUsage(await harnessSettingsRequest(input, directory, "/usage")).data
}

export async function upgradeHarness(input: HarnessServer, directory: string, id: string) {
  return decodeUpdate(
    await harnessSettingsRequest(input, directory, `/upgrade/${encodeURIComponent(id)}`, { method: "POST" }),
  ).data
}

export async function createSessionForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  value?: HarnessSessionCreateInput,
): Promise<SessionInfo> {
  const response = await (input.fetch ?? globalThis.fetch)(`${input.server.url.replace(/\/+$/, "")}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.server.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({
              username: input.server.username,
              password: input.server.password,
            })}`,
          }
        : {}),
    },
    body: JSON.stringify(value ?? {}),
  }).catch(() => {
    throw new SessionCreateError()
  })
  if (!response.ok) throw new SessionCreateError(response.status)
  const payload: unknown = await response.json().catch(() => {
    throw new SessionCreateError(response.status)
  })
  if (!isRecord(payload) || !isRecord(payload.data)) throw new SessionCreateError()
  return payload.data as SessionInfo
}

export async function promptSessionForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  value: SessionPromptInput,
) {
  const response = await (input.fetch ?? globalThis.fetch)(
    `${input.server.url.replace(/\/+$/, "")}/api/session/${encodeURIComponent(value.sessionID)}/prompt`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.server.password
          ? {
              Authorization: `Basic ${authTokenFromCredentials({
                username: input.server.username,
                password: input.server.password,
              })}`,
            }
          : {}),
      },
      body: JSON.stringify({
        id: value.id,
        prompt: {
          text: value.text,
          files: value.files?.map((file) => ({
            uri: file.uri,
            name: file.name,
            description: file.description,
            source: file.mention,
          })),
          agents: value.agents?.map((agent) => ({ name: agent.name, source: agent.mention })),
        },
        delivery: value.delivery,
        resume: value.resume,
      }),
    },
  )
  if (!response.ok) throw new Error(`Harness prompt failed (${response.status}).`)
}

export async function switchHarnessForServer(
  input: {
    server: ServerConnection.HttpBase
    fetch?: typeof globalThis.fetch
  },
  sessionID: string,
  value: { instanceID: Harness.InstanceID; model?: Harness.ModelSelection },
) {
  const response = await (input.fetch ?? globalThis.fetch)(
    `${input.server.url.replace(/\/+$/, "")}/api/session/${encodeURIComponent(sessionID)}/harness`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.server.password
          ? {
              Authorization: `Basic ${authTokenFromCredentials({
                username: input.server.username,
                password: input.server.password,
              })}`,
            }
          : {}),
      },
      body: JSON.stringify(value),
    },
  )
  if (!response.ok) throw new Error(`Harness switch failed (${response.status}).`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function sessionDiffForServer(
  input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch },
  value: { sessionID: string; messageID: string },
): Promise<VcsFileDiff[]> {
  const url = new URL(`${input.server.url.replace(/\/+$/, "")}/api/session/${encodeURIComponent(value.sessionID)}/diff`)
  url.searchParams.set("messageID", value.messageID)
  const response = await (input.fetch ?? globalThis.fetch)(url, {
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
        }
      : undefined,
  })
  if (!response.ok) throw new Error(`Session diff failed (${response.status})`)
  const payload = (await response.json()) as {
    data: {
      path: string
      patch: string
      additions: number
      deletions: number
      status: "added" | "modified" | "deleted"
    }[]
  }
  return payload.data.map(({ path, ...diff }) => ({ ...diff, file: path }))
}
