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
      name: "OpenCode",
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

const decodeSettingsList = Schema.decodeUnknownSync(Location.response(Schema.Array(HarnessSchema.SettingsEntry)))
const decodeSettingsEntry = Schema.decodeUnknownSync(Location.response(HarnessSchema.SettingsEntry))
const decodeDiscovery = Schema.decodeUnknownSync(Location.response(HarnessSchema.Discovery))

type HarnessServer = {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}

// Settings routes return `{ reason, message }` on failure; the message is written for people.
async function harnessSettingsRequest(input: HarnessServer, directory: string, route: string, init?: RequestInit) {
  const url = new URL(`${input.server.url.replace(/\/+$/, "")}/api/harness${route}`)
  url.searchParams.set("location[directory]", directory)
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
      : `Harness request failed (${response.status}).`
  throw new Error(message)
}

export async function listHarnessSettings(input: HarnessServer, directory: string) {
  return decodeSettingsList(await harnessSettingsRequest(input, directory, "/settings")).data
}

export async function discoverHarness(input: HarnessServer, directory: string, value: HarnessSchema.DiscoverInput) {
  return decodeDiscovery(
    await harnessSettingsRequest(input, directory, "/discover", { method: "POST", body: JSON.stringify(value) }),
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
