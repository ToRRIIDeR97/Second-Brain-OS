import { createHash } from "node:crypto"
import type { GoogleCalendarProviderEvent, GoogleTaskProviderTask } from "@opencode-ai/app"

export type GoogleEventResponse = {
  id?: string
  summary?: string
  description?: string
  status?: string
  etag?: string
  recurringEventId?: string
  attendees?: unknown[]
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
}

export type GoogleTaskResponse = {
  id?: string
  title?: string
  notes?: string
  due?: string
  completed?: string
  status?: string
  deleted?: boolean
  updated?: string
  etag?: string
}

export function googleScopes(access: "read" | "write") {
  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    access === "write" ? "https://www.googleapis.com/auth/tasks" : "https://www.googleapis.com/auth/tasks.readonly",
  ]
  if (access === "write") scopes.splice(1, 0, "https://www.googleapis.com/auth/calendar.events")
  return scopes
}

export type GoogleClient = { clientId: string; clientSecret: string }

/** Validates and trims a Desktop OAuth client, throwing the error code the Calendar page maps. */
export function validateGoogleClient(clientId: string, clientSecret: string): GoogleClient {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id.endsWith(".apps.googleusercontent.com") || id.length > 512) throw new Error("google_client_id_invalid")
  if (!secret || secret.length > 512 || /\s/.test(secret)) throw new Error("google_client_secret_invalid")
  return { clientId: id, clientSecret: secret }
}

/** The client compiled into this build, or undefined when the build has none or an invalid one. */
export function builtInGoogleClient(env: { clientId?: string; clientSecret?: string }) {
  try {
    return validateGoogleClient(env.clientId ?? "", env.clientSecret ?? "")
  } catch {
    return undefined
  }
}

/** Typed credentials win over the built-in client; a partly typed pair is validated, never replaced. */
export function resolveGoogleClient(
  input: { clientId?: string; clientSecret?: string },
  builtIn: GoogleClient | undefined,
): GoogleClient {
  const typed = Boolean(input.clientId?.trim() || input.clientSecret?.trim())
  if (typed) return validateGoogleClient(input.clientId ?? "", input.clientSecret ?? "")
  if (builtIn) return builtIn
  throw new Error("google_client_missing")
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function googleEventId(idempotencyKey: string) {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)
}

export function normalizeGoogleEvent(input: GoogleEventResponse): GoogleCalendarProviderEvent | undefined {
  if (!input.id || input.status === "cancelled" || !input.start || !input.end) return
  const allDay = typeof input.start.date === "string"
  const start = input.start.dateTime
  const end = input.end.dateTime
  const date = allDay ? input.start.date : start?.slice(0, 10)
  if (!date) return
  const endDate = allDay && input.end.date ? previousDate(input.end.date) : end?.slice(0, 10)
  return {
    providerId: input.id,
    calendarId: "primary",
    title: input.summary?.trim() || "Untitled event",
    date,
    ...(endDate && endDate !== date ? { endDate } : {}),
    ...(start ? { start: start.slice(11, 16) } : {}),
    ...(end ? { end: end.slice(11, 16) } : {}),
    ...(input.description ? { details: input.description } : {}),
    ...(input.start.timeZone || input.end.timeZone ? { timezone: input.start.timeZone ?? input.end.timeZone } : {}),
    allDay,
    ...(input.recurringEventId ? { recurringSeriesId: input.recurringEventId } : {}),
    participantCount: input.attendees?.length ?? 0,
    ...(input.etag ? { etag: input.etag } : {}),
  }
}

export function googleEventPayload(event: GoogleCalendarProviderEvent) {
  if (event.recurringSeriesId || event.participantCount > 0) throw new Error("google_write_requires_approval")
  if (event.allDay) {
    return {
      summary: event.title,
      description: event.details,
      start: { date: event.date },
      end: { date: nextDate(event.endDate ?? event.date) },
    }
  }
  if (!event.start || !event.end || !event.timezone) throw new Error("google_time_required")
  return {
    summary: event.title,
    description: event.details,
    start: { dateTime: `${event.date}T${event.start}:00`, timeZone: event.timezone },
    end: { dateTime: `${event.endDate ?? event.date}T${event.end}:00`, timeZone: event.timezone },
  }
}

export function normalizeGoogleTask(
  input: GoogleTaskResponse,
  taskList: { id: string; title: string },
): GoogleTaskProviderTask | undefined {
  if (!input.id || input.deleted || !input.updated) return
  return {
    providerId: input.id,
    taskListId: taskList.id,
    taskListTitle: taskList.title.trim() || "Google Tasks",
    title: input.title?.trim() || "Untitled task",
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.due ? { dueDate: input.due.slice(0, 10) } : {}),
    ...(input.status === "completed" && input.completed ? { completedAt: input.completed } : {}),
    updatedAt: input.updated,
    ...(input.etag ? { etag: input.etag } : {}),
  }
}

export function googleTaskPayload(task: GoogleTaskProviderTask) {
  if (!task.title.trim() || task.title.length > 300 || (task.notes?.length ?? 0) > 8_192) {
    throw new Error("google_task_invalid")
  }
  return {
    title: task.title.trim(),
    notes: task.notes?.trim() || null,
    due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
    status: task.completedAt ? "completed" : "needsAction",
    completed: task.completedAt ?? null,
  }
}

function nextDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error("google_date_invalid")
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error("google_date_invalid")
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>
type OutboxState = "pending" | "offline" | "failed" | "conflict" | "succeeded"

export const GOOGLE_OUTBOX_LIMIT = 100
export const GOOGLE_OUTBOX_MAX_ATTEMPTS = 5

export async function requestGoogleToken(fetch: Fetch, endpoint: string, input: Record<string, string>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(input),
    signal: AbortSignal.timeout(30_000),
  })
  const value = (await response.json().catch(() => ({}))) as GoogleTokenResponse
  // A revoked or expired refresh token needs new consent; retrying the exchange cannot succeed.
  if (value.error === "invalid_grant" && input.grant_type === "refresh_token") {
    throw new Error("google_reconnect_required")
  }
  if (!response.ok || value.error) throw new Error("google_token_exchange_failed")
  return value
}

/** Caches the access token until shortly before `expires_in`, so queued writes share one exchange. */
export function createGoogleAccessTokens(input: {
  fetch: Fetch
  endpoint: string
  onRotate: (refreshToken: string) => void
  now?: () => number
}) {
  const now = input.now ?? Date.now
  let cached: { clientId: string; token: string; expiresAt: number } | undefined
  const fresh = (config: Credentials) => cached?.clientId === config.clientId && cached.expiresAt > now()
  const get = async (config: Credentials) => {
    if (cached && fresh(config)) return cached.token
    cached = undefined
    const tokens = await requestGoogleToken(input.fetch, input.endpoint, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    })
    if (!tokens.access_token) throw new Error("google_reconnect_required")
    if (tokens.refresh_token) input.onRotate(tokens.refresh_token)
    // Renew a minute early so a token never expires during a request.
    const lifetime = (tokens.expires_in ?? 0) * 1_000 - 60_000
    if (lifetime > 0) cached = { clientId: config.clientId, token: tokens.access_token, expiresAt: now() + lifetime }
    return tokens.access_token
  }
  return {
    get,
    /**
     * Runs `request` with an access token. When a cached token is rejected (reconnect-required),
     * the token is exchanged again and the request retried once before the error is reported.
     */
    async with<T>(config: Credentials, request: (accessToken: string) => Promise<T>) {
      const reused = fresh(config)
      return request(await get(config)).catch(async (error) => {
        if (!reused || !(error instanceof Error) || error.message !== "google_reconnect_required") throw error
        cached = undefined
        return request(await get(config))
      })
    },
    clear() {
      cached = undefined
    },
  }
}

type Credentials = { clientId: string; clientSecret: string; refreshToken: string }

/** Drops succeeded entries first, then old failures. Queued (pending or offline) writes are never dropped. */
export function pruneOutbox<T extends { state: OutboxState }>(entries: T[], limit = GOOGLE_OUTBOX_LIMIT) {
  const excess = entries.length - limit
  if (excess <= 0) return entries
  const drop = new Set(
    [
      ...entries.filter((entry) => entry.state === "succeeded"),
      ...entries.filter((entry) => entry.state === "failed" || entry.state === "conflict"),
    ].slice(0, excess),
  )
  return entries.filter((entry) => !drop.has(entry))
}

type GoogleErrorBody = {
  error?: {
    status?: string
    errors?: { reason?: string }[]
    details?: { reason?: string }[]
  }
}

/**
 * Turns a failed Google API response into an error code the Calendar page can explain.
 * `reason` is Google's machine-readable reason (never message text), safe to log.
 */
export function classifyGoogleError(status: number, url: string, body: string) {
  const api = new URL(url).hostname === "tasks.googleapis.com" ? "tasks" : "calendar"
  const parsed = (() => {
    try {
      return JSON.parse(body) as GoogleErrorBody
    } catch {
      return undefined
    }
  })()
  const reasons = [
    ...(parsed?.error?.details ?? []).map((item) => item.reason),
    ...(parsed?.error?.errors ?? []).map((item) => item.reason),
    parsed?.error?.status,
  ].filter((item): item is string => typeof item === "string" && /^[A-Za-z_]{1,64}$/.test(item))
  const reason = reasons[0]
  const has = (...names: string[]) => reasons.some((item) => names.includes(item))
  const code = (() => {
    if (has("SERVICE_DISABLED", "accessNotConfigured")) return `google_api_disabled_${api}`
    if (has("ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions")) return "google_scope_missing"
    if (status === 429 || has("RATE_LIMIT_EXCEEDED", "rateLimitExceeded", "userRateLimitExceeded")) {
      return "google_rate_limited"
    }
    return `google_http_${status}`
  })()
  return { code, api, reason }
}

/** `attempts` counts the attempt that just failed. */
export function outboxFailureState(message: string, attempts: number): "conflict" | "failed" | "offline" {
  if (message === "google_conflict") return "conflict"
  if (message.startsWith("google_http_")) return "failed"
  // The write waits for the user to reconnect; sync stops at the token exchange until then.
  if (message === "google_reconnect_required") return "offline"
  return attempts >= GOOGLE_OUTBOX_MAX_ATTEMPTS ? "failed" : "offline"
}
