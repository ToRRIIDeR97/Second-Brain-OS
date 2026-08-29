import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient, type SessionCreateInput, type SessionInfo } from "@opencode-ai/client/promise"
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
