import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type {
  GoogleCalendarConnection,
  GoogleCalendarPlatform,
  GoogleCalendarProviderEvent,
  GoogleCalendarWrite,
  GoogleTaskProviderTask,
  GoogleTaskWrite,
} from "@opencode-ai/app"
import { net, safeStorage, shell } from "electron"
import { getStore } from "./store"
import {
  googleEventId,
  googleEventPayload,
  googleScopes,
  googleTaskPayload,
  normalizeGoogleEvent,
  normalizeGoogleTask,
  pkceChallenge,
  type GoogleEventResponse,
  type GoogleTaskResponse,
} from "./google-calendar-domain"

const storeName = "second-brain.google"
const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
const tokenEndpoint = "https://oauth2.googleapis.com/token"
const revokeEndpoint = "https://oauth2.googleapis.com/revoke"
const calendarEndpoint = "https://www.googleapis.com/calendar/v3/calendars/primary"
const eventsEndpoint = `${calendarEndpoint}/events`
const taskListsEndpoint = "https://tasks.googleapis.com/tasks/v1/users/@me/lists"
const tasksEndpoint = "https://tasks.googleapis.com/tasks/v1/lists"
const oauthTimeoutMs = 5 * 60 * 1_000

type Config = {
  clientId: string
  clientSecret: string
  refreshToken: string
  access: "read" | "write"
  accountLabel?: string
  lastSyncedAt?: string
}

type StoredOutbox = {
  id: string
  input: GoogleCalendarWrite
  state: "pending" | "offline" | "failed" | "conflict" | "succeeded"
  attempts: number
  createdAt: string
  lastError?: string
  result?: GoogleCalendarProviderEvent | null
}

type StoredTaskOutbox = {
  id: string
  input: GoogleTaskWrite
  state: "pending" | "offline" | "failed" | "conflict" | "succeeded"
  attempts: number
  createdAt: string
  lastError?: string
  result?: GoogleTaskProviderTask | null
}

type TaskListResponse = { id?: string; title?: string }

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  error?: string
}

export function createGoogleCalendarService(): GoogleCalendarPlatform {
  let busy = false

  const status = async (): Promise<GoogleCalendarConnection> => {
    const available = secureStorageAvailable()
    if (!available) {
      return {
        available: false,
        configured: false,
        connected: false,
        access: "read",
        pendingWrites: 0,
        failedWrites: 0,
      }
    }
    const config = readConfig()
    const outbox = readOutbox()
    const taskOutbox = readTaskOutbox()
    return {
      available: true,
      configured: Boolean(config?.clientId && config.clientSecret),
      connected: Boolean(config?.refreshToken),
      access: config?.access ?? "read",
      pendingWrites:
        outbox.filter((operation) => operation.state === "pending" || operation.state === "offline").length +
        taskOutbox.filter((operation) => operation.state === "pending" || operation.state === "offline").length,
      failedWrites:
        outbox.filter((operation) => operation.state === "failed" || operation.state === "conflict").length +
        taskOutbox.filter((operation) => operation.state === "failed" || operation.state === "conflict").length,
      ...(config?.accountLabel ? { accountLabel: config.accountLabel } : {}),
      ...(config?.lastSyncedAt ? { lastSyncedAt: config.lastSyncedAt } : {}),
    }
  }

  const connect: GoogleCalendarPlatform["connect"] = async (input) => {
    if (busy) throw new Error("google_operation_busy")
    if (!secureStorageAvailable()) throw new Error("google_secure_storage_unavailable")
    const windowId = input.windowId
    if (!Number.isSafeInteger(windowId) || windowId! <= 0) throw new Error("google_window_invalid")
    validateCredentials(input.clientId, input.clientSecret)
    busy = true
    try {
      const tokens = await authorize({ ...input, windowId: windowId! })
      if (!tokens.access_token || !tokens.refresh_token) throw new Error("google_refresh_token_missing")
      const account = await providerJson<{ summary?: string; id?: string }>(calendarEndpoint, tokens.access_token)
      writeConfig({
        clientId: input.clientId.trim(),
        clientSecret: input.clientSecret.trim(),
        refreshToken: tokens.refresh_token,
        access: input.access,
        accountLabel: account.summary ?? account.id,
      })
      return status()
    } finally {
      busy = false
    }
  }

  const sync: GoogleCalendarPlatform["sync"] = async () => {
    if (busy) throw new Error("google_operation_busy")
    const config = requireConfig()
    busy = true
    try {
      await retryOutbox(config)
      await retryTaskOutbox(config)
      const accessToken = await refreshAccessToken(config)
      const events: GoogleCalendarProviderEvent[] = []
      let pageToken: string | undefined
      do {
        const url = new URL(eventsEndpoint)
        url.searchParams.set("singleEvents", "true")
        url.searchParams.set("showDeleted", "false")
        url.searchParams.set("maxResults", "2500")
        url.searchParams.set("timeMin", rangeDate(-365))
        url.searchParams.set("timeMax", rangeDate(730))
        if (pageToken) url.searchParams.set("pageToken", pageToken)
        const page = await providerJson<{ items?: GoogleEventResponse[]; nextPageToken?: string }>(url, accessToken)
        for (const item of page.items ?? []) {
          const event = normalizeGoogleEvent(item)
          if (event) events.push(event)
        }
        pageToken = page.nextPageToken
      } while (pageToken)
      const tasks = await fetchGoogleTasks(accessToken)
      const next = { ...config, lastSyncedAt: new Date().toISOString() }
      writeConfig(next)
      return { events, tasks, connection: await status() }
    } finally {
      busy = false
    }
  }

  const write: GoogleCalendarPlatform["write"] = async (input) => {
    if (busy) throw new Error("google_operation_busy")
    const config = requireConfig()
    if (config.access !== "write") throw new Error("google_write_consent_required")
    const request =
      input.kind === "create"
        ? { ...input, event: { ...input.event, providerId: googleEventId(input.idempotencyKey) } }
        : input
    validateWrite(request)
    const outbox = readOutbox()
    const existing = outbox.find((operation) => operation.input.idempotencyKey === request.idempotencyKey)
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(request)) throw new Error("google_idempotency_collision")
      if (existing.state === "succeeded") return { state: "synced", event: existing.result ?? null }
    }
    const operation =
      existing ??
      ({
        id: randomUUID(),
        input: request,
        state: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
      } satisfies StoredOutbox)
    if (!existing) persistOutbox([...outbox, operation])
    busy = true
    try {
      return await dispatch(config, operation)
    } finally {
      busy = false
    }
  }

  const writeTask: GoogleCalendarPlatform["writeTask"] = async (input) => {
    if (busy) throw new Error("google_operation_busy")
    const config = requireConfig()
    if (config.access !== "write") throw new Error("google_write_consent_required")
    validateTaskWrite(input)
    const outbox = readTaskOutbox()
    const existing = outbox.find((operation) => operation.input.idempotencyKey === input.idempotencyKey)
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error("google_idempotency_collision")
      if (existing.state === "succeeded") return { state: "synced", task: existing.result ?? null }
    }
    const operation =
      existing ??
      ({
        id: randomUUID(),
        input,
        state: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
      } satisfies StoredTaskOutbox)
    if (!existing) persistTaskOutbox([...outbox, operation])
    busy = true
    try {
      return await dispatchTask(config, operation)
    } finally {
      busy = false
    }
  }

  const disconnect: GoogleCalendarPlatform["disconnect"] = async () => {
    if (busy) throw new Error("google_operation_busy")
    const config = readConfig()
    busy = true
    try {
      if (config?.refreshToken) {
        await net
          .fetch(revokeEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: config.refreshToken }),
            signal: AbortSignal.timeout(30_000),
          })
          .catch(() => undefined)
      }
      getStore(storeName).clear()
      return status()
    } finally {
      busy = false
    }
  }

  return { status, connect, sync, write, writeTask, disconnect }
}

async function fetchGoogleTasks(accessToken: string) {
  const taskLists: { id: string; title: string }[] = []
  let listPageToken: string | undefined
  do {
    const url = new URL(taskListsEndpoint)
    url.searchParams.set("maxResults", "1000")
    if (listPageToken) url.searchParams.set("pageToken", listPageToken)
    const page = await providerJson<{ items?: TaskListResponse[]; nextPageToken?: string }>(url, accessToken)
    for (const item of page.items ?? []) {
      if (item.id) taskLists.push({ id: item.id, title: item.title?.trim() || "Google Tasks" })
      if (taskLists.length >= 2_000) break
    }
    listPageToken = taskLists.length < 2_000 ? page.nextPageToken : undefined
  } while (listPageToken)

  const tasks: GoogleTaskProviderTask[] = []
  for (const taskList of taskLists) {
    let taskPageToken: string | undefined
    do {
      const url = new URL(`${tasksEndpoint}/${encodeURIComponent(taskList.id)}/tasks`)
      url.searchParams.set("maxResults", "100")
      url.searchParams.set("showCompleted", "true")
      url.searchParams.set("showHidden", "true")
      url.searchParams.set("showDeleted", "false")
      if (taskPageToken) url.searchParams.set("pageToken", taskPageToken)
      const page = await providerJson<{ items?: GoogleTaskResponse[]; nextPageToken?: string }>(url, accessToken)
      for (const item of page.items ?? []) {
        const task = normalizeGoogleTask(item, taskList)
        if (task) tasks.push(task)
        if (tasks.length >= 5_000) return tasks
      }
      taskPageToken = page.nextPageToken
    } while (taskPageToken)
  }
  return tasks
}

async function authorize(input: {
  clientId: string
  clientSecret: string
  access: "read" | "write"
  windowId: number
}) {
  const verifier = randomBytes(32).toString("base64url")
  const state = `${input.windowId}.${randomBytes(24).toString("base64url")}`
  const callback = Promise.withResolvers<string>()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/oauth2/callback") {
      response.writeHead(404).end("Not found")
      return
    }
    const returnedState = url.searchParams.get("state")
    const code = url.searchParams.get("code")
    const error = url.searchParams.get("error")
    response.setHeader("Content-Type", "text/html; charset=utf-8")
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
    if (error || returnedState !== state || !code) {
      response.writeHead(400).end("<p>Google sign-in could not be completed. You can close this window.</p>")
      callback.reject(new Error(error ? "google_oauth_denied" : "google_oauth_state_mismatch"))
      return
    }
    response.writeHead(200).end("<p>Google Calendar is connected. You can close this window.</p>")
    callback.resolve(code)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("google_loopback_unavailable")
  }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`
  const url = new URL(authorizeEndpoint)
  url.searchParams.set("client_id", input.clientId.trim())
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("scope", googleScopes(input.access).join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", pkceChallenge(verifier))
  url.searchParams.set("code_challenge_method", "S256")
  try {
    await shell.openExternal(url.href)
    const code = await Promise.race([
      callback.promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("google_oauth_timeout")), oauthTimeoutMs)),
    ])
    return tokenRequest({
      client_id: input.clientId.trim(),
      client_secret: input.clientSecret.trim(),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function tokenRequest(input: Record<string, string>) {
  const response = await net.fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(input),
    signal: AbortSignal.timeout(30_000),
  })
  const value = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || value.error) throw new Error("google_token_exchange_failed")
  return value
}

async function refreshAccessToken(config: Config) {
  const tokens = await tokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  })
  if (!tokens.access_token) throw new Error("google_reconnect_required")
  if (tokens.refresh_token) writeConfig({ ...config, refreshToken: tokens.refresh_token })
  return tokens.access_token
}

async function providerJson<T>(input: string | URL, accessToken: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${accessToken}`)
  if (init?.body) headers.set("Content-Type", "application/json")
  const response = await net.fetch(input.toString(), {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 401) throw new Error("google_reconnect_required")
  if (response.status === 412) throw new Error("google_conflict")
  if (!response.ok) throw new Error(`google_http_${response.status}`)
  return (await response.json()) as T
}

async function dispatch(config: Config, operation: StoredOutbox) {
  updateOperation(operation.id, { state: "pending", attempts: operation.attempts + 1, lastError: undefined })
  try {
    const accessToken = await refreshAccessToken(config)
    const input = operation.input
    let result: GoogleCalendarProviderEvent | null
    if (input.kind === "delete") {
      const headers = input.event.etag ? { "If-Match": input.event.etag } : undefined
      const response = await net.fetch(`${eventsEndpoint}/${encodeURIComponent(input.event.providerId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}`, ...headers },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 412) throw new Error("google_conflict")
      if (!response.ok && response.status !== 404) throw new Error(`google_http_${response.status}`)
      result = null
    } else {
      const id = input.kind === "create" ? googleEventId(input.idempotencyKey) : input.event.providerId
      const payload = {
        ...googleEventPayload(input.event),
        ...(input.kind === "create" ? { id } : {}),
      }
      const endpoint = input.kind === "create" ? eventsEndpoint : `${eventsEndpoint}/${encodeURIComponent(id)}`
      const headers = input.kind === "update" && input.event.etag ? { "If-Match": input.event.etag } : undefined
      try {
        const saved = await providerJson<GoogleEventResponse>(endpoint, accessToken, {
          method: input.kind === "create" ? "POST" : "PATCH",
          headers,
          body: JSON.stringify(payload),
        })
        result = normalizeGoogleEvent(saved) ?? null
      } catch (error) {
        if (input.kind !== "create" || !(error instanceof Error) || error.message !== "google_http_409") throw error
        result =
          normalizeGoogleEvent(
            await providerJson<GoogleEventResponse>(`${eventsEndpoint}/${encodeURIComponent(id)}`, accessToken),
          ) ?? null
      }
    }
    updateOperation(operation.id, { state: "succeeded", result, lastError: undefined })
    return { state: "synced" as const, event: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_write_failed"
    const state: "conflict" | "failed" | "offline" =
      message === "google_conflict" ? "conflict" : message.startsWith("google_http_") ? "failed" : "offline"
    updateOperation(operation.id, { state, lastError: message })
    return { state, event: pendingEvent(operation.input) }
  }
}

async function retryOutbox(config: Config) {
  for (const operation of readOutbox()) {
    if (operation.state !== "pending" && operation.state !== "offline") continue
    await dispatch(config, operation)
  }
}

async function dispatchTask(config: Config, operation: StoredTaskOutbox) {
  updateTaskOperation(operation.id, { state: "pending", attempts: operation.attempts + 1, lastError: undefined })
  try {
    const accessToken = await refreshAccessToken(config)
    const input = operation.input
    const collection = `${tasksEndpoint}/${encodeURIComponent(input.task.taskListId)}/tasks`
    let result: GoogleTaskProviderTask | null
    if (input.kind === "delete") {
      const response = await net.fetch(`${collection}/${encodeURIComponent(input.task.providerId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(input.task.etag ? { "If-Match": input.task.etag } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 412) throw new Error("google_conflict")
      if (!response.ok && response.status !== 404) throw new Error(`google_http_${response.status}`)
      result = null
    } else {
      const endpoint =
        input.kind === "create" ? collection : `${collection}/${encodeURIComponent(input.task.providerId)}`
      const saved = await providerJson<GoogleTaskResponse>(endpoint, accessToken, {
        method: input.kind === "create" ? "POST" : "PATCH",
        headers: input.kind === "update" && input.task.etag ? { "If-Match": input.task.etag } : undefined,
        body: JSON.stringify(googleTaskPayload(input.task)),
      })
      result = normalizeGoogleTask(saved, { id: input.task.taskListId, title: input.task.taskListTitle }) ?? null
      if (!result) throw new Error("google_task_invalid_response")
    }
    updateTaskOperation(operation.id, { state: "succeeded", result, lastError: undefined })
    return { state: "synced" as const, task: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : "google_task_write_failed"
    const state: "conflict" | "failed" | "offline" =
      message === "google_conflict" ? "conflict" : message.startsWith("google_http_") ? "failed" : "offline"
    updateTaskOperation(operation.id, { state, lastError: message })
    return { state, task: operation.input.kind === "delete" ? operation.input.task : operation.input.task }
  }
}

async function retryTaskOutbox(config: Config) {
  for (const operation of readTaskOutbox()) {
    if (operation.state !== "pending" && operation.state !== "offline") continue
    await dispatchTask(config, operation)
  }
}

function pendingEvent(input: GoogleCalendarWrite) {
  if (input.kind === "delete") return input.event
  return {
    ...input.event,
    providerId: input.kind === "create" ? googleEventId(input.idempotencyKey) : input.event.providerId,
  }
}

function validateCredentials(clientId: string, clientSecret: string) {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id.endsWith(".apps.googleusercontent.com") || id.length > 512) throw new Error("google_client_id_invalid")
  if (!secret || secret.length > 512 || /\s/.test(secret)) throw new Error("google_client_secret_invalid")
}

function validateWrite(input: GoogleCalendarWrite) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 256) throw new Error("google_idempotency_invalid")
  if (!input.event.title.trim() || input.event.calendarId !== "primary") throw new Error("google_event_invalid")
  googleEventPayload(input.event)
  if (input.kind !== "create" && !input.event.providerId) throw new Error("google_provider_id_required")
}

function validateTaskWrite(input: GoogleTaskWrite) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 256) throw new Error("google_idempotency_invalid")
  if (!input.task.taskListId || input.task.taskListId.length > 1_024) throw new Error("google_task_list_invalid")
  googleTaskPayload(input.task)
  if (input.kind !== "create" && (!input.task.providerId || input.task.providerId.startsWith("pending:"))) {
    throw new Error("google_provider_id_required")
  }
}

function rangeDate(days: number) {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString()
}

function secureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
}

function readConfig(): Config | undefined {
  const store = getStore(storeName)
  const clientId = stringValue(store.get("clientId"))
  const encryptedClientSecret = stringValue(store.get("clientSecret"))
  const encryptedRefreshToken = stringValue(store.get("refreshToken"))
  if (!clientId || !encryptedClientSecret || !encryptedRefreshToken) return
  try {
    return {
      clientId,
      clientSecret: decrypt(encryptedClientSecret),
      refreshToken: decrypt(encryptedRefreshToken),
      access: store.get("access") === "write" ? "write" : "read",
      ...(stringValue(store.get("accountLabel")) ? { accountLabel: stringValue(store.get("accountLabel")) } : {}),
      ...(stringValue(store.get("lastSyncedAt")) ? { lastSyncedAt: stringValue(store.get("lastSyncedAt")) } : {}),
    }
  } catch {
    return
  }
}

function requireConfig() {
  if (!secureStorageAvailable()) throw new Error("google_secure_storage_unavailable")
  const config = readConfig()
  if (!config) throw new Error("google_not_connected")
  return config
}

function writeConfig(config: Config) {
  const store = getStore(storeName)
  store.set("clientId", config.clientId)
  store.set("clientSecret", encrypt(config.clientSecret))
  store.set("refreshToken", encrypt(config.refreshToken))
  store.set("access", config.access)
  if (config.accountLabel) store.set("accountLabel", config.accountLabel)
  if (config.lastSyncedAt) store.set("lastSyncedAt", config.lastSyncedAt)
}

function encrypt(value: string) {
  return safeStorage.encryptString(value).toString("base64")
}

function decrypt(value: string) {
  return safeStorage.decryptString(Buffer.from(value, "base64"))
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function readOutbox() {
  const value = getStore(storeName).get("outbox")
  if (!Array.isArray(value)) return []
  return value.filter((item): item is StoredOutbox => Boolean(item && typeof item === "object" && "id" in item))
}

function persistOutbox(value: StoredOutbox[]) {
  getStore(storeName).set("outbox", value.slice(-100))
}

function updateOperation(id: string, patch: Partial<StoredOutbox>) {
  persistOutbox(readOutbox().map((operation) => (operation.id === id ? { ...operation, ...patch } : operation)))
}

function readTaskOutbox() {
  const value = getStore(storeName).get("taskOutbox")
  if (!Array.isArray(value)) return []
  return value.filter((item): item is StoredTaskOutbox => Boolean(item && typeof item === "object" && "id" in item))
}

function persistTaskOutbox(value: StoredTaskOutbox[]) {
  getStore(storeName).set("taskOutbox", value.slice(-100))
}

function updateTaskOperation(id: string, patch: Partial<StoredTaskOutbox>) {
  persistTaskOutbox(readTaskOutbox().map((operation) => (operation.id === id ? { ...operation, ...patch } : operation)))
}
