export * as HarnessUsage from "./usage"

import { Cause, Clock, Effect, Option, Schema } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

/** One usage window a harness's subscription reports, such as the 5-hour or weekly limit. */
export interface UsageWindow {
  readonly id: string
  readonly label: string
  readonly usedPercent: number
  /** Epoch milliseconds. */
  readonly resetsAt?: number
  readonly windowMinutes?: number
}

export interface UsageReport {
  readonly instanceID: string
  readonly status: "available" | "unsupported" | "signed-out" | "error"
  readonly windows: ReadonlyArray<UsageWindow>
  readonly reason?: string
  readonly checkedAt: number
}

export type Result = Pick<UsageReport, "status" | "windows" | "reason">

const claudeWindows = [
  { id: "five_hour", label: "5-hour" },
  { id: "seven_day", label: "Weekly" },
  { id: "seven_day_opus", label: "Weekly (Opus)" },
  { id: "seven_day_sonnet", label: "Weekly (Sonnet)" },
] as const

/**
 * Reads Anthropic's OAuth usage response: `{ five_hour: { utilization, resets_at } | null, seven_day: ..., ... }`.
 * Only the known windows are reported, in a fixed order: the response also carries internal keys with the same
 * shape that aren't meant for people. Malformed input yields `[]`.
 */
export function parseClaudeUsage(body: unknown): UsageWindow[] {
  if (!isRecord(body)) return []
  return claudeWindows.flatMap((window) => {
    const value = body[window.id]
    if (!isRecord(value) || !finite(value.utilization)) return []
    const resetsAt = typeof value.resets_at === "string" ? Date.parse(value.resets_at) : Number.NaN
    return [
      {
        id: window.id,
        label: window.label,
        usedPercent: clamp(value.utilization),
        ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
      },
    ]
  })
}

/**
 * Reads the Codex app-server `account/rateLimits/read` result:
 * `{ rateLimits: { primary?: W | null, secondary?: W | null } }` with
 * `W = { usedPercent, windowDurationMins?, resetsAt? (epoch seconds) }`. Malformed input yields `[]`.
 */
export function parseCodexRateLimits(body: unknown): UsageWindow[] {
  const limits = isRecord(body) && isRecord(body.rateLimits) ? body.rateLimits : undefined
  if (!limits) return []
  return (["primary", "secondary"] as const).flatMap((id) => {
    const value = limits[id]
    if (!isRecord(value) || !finite(value.usedPercent)) return []
    const minutes =
      finite(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : undefined
    return [
      {
        id,
        label: minutes ? minutesLabel(minutes) : id === "primary" ? "Primary" : "Secondary",
        usedPercent: clamp(value.usedPercent),
        ...(finite(value.resetsAt) ? { resetsAt: value.resetsAt * 1000 } : {}),
        ...(minutes ? { windowMinutes: minutes } : {}),
      },
    ]
  })
}

/**
 * The Claude Code OAuth access token from `$CLAUDE_CONFIG_DIR/.credentials.json` or `~/.claude/.credentials.json`.
 * The token stays in the server process: callers pass it only to the usage request, never to a response or a log.
 */
export const readClaudeToken = (env: Readonly<Record<string, string | undefined>> = process.env, now = Date.now()) =>
  Effect.promise(
    async (): Promise<
      { readonly status: "valid"; readonly token: string } | { readonly status: "missing" | "expired" }
    > => {
      const dir = env.CLAUDE_CONFIG_DIR || path.join(env.HOME ?? os.homedir(), ".claude")
      const value = await readCredentialFile(path.join(dir, ".credentials.json"))
      const oauth = isRecord(value) && isRecord(value.claudeAiOauth) ? value.claudeAiOauth : undefined
      if (!oauth || typeof oauth.accessToken !== "string" || !oauth.accessToken) return { status: "missing" }
      if (finite(oauth.expiresAt) && oauth.expiresAt <= now) return { status: "expired" }
      return { status: "valid", token: oauth.accessToken }
    },
  )

/** Asks Anthropic for the subscription usage behind a Claude Code OAuth token. */
export const fetchClaudeUsage = (token: string, request: typeof fetch = fetch) =>
  Effect.tryPromise({
    try: async (signal): Promise<Result> => {
      const response = await request("https://api.anthropic.com/api/oauth/usage", {
        headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
        signal,
      })
      if (response.status === 401 || response.status === 403)
        return { status: "signed-out", windows: [], reason: "Claude Code sign-in has expired." }
      if (!response.ok)
        return { status: "error", windows: [], reason: `Usage request failed (HTTP ${response.status}).` }
      const body = await readBody(response)
      if (!body) return badBody
      return { status: "available", windows: parseClaudeUsage(body.value) }
    },
    catch: () => new Error("Could not reach api.anthropic.com."),
  })

const commandCodeWindows = [
  { key: "fiveHour", id: "five_hour", label: "5-hour" },
  { key: "weekly", id: "weekly", label: "Weekly" },
] as const

/**
 * Reads the `windowLimits` Command Code's own `/usage` overlay shows: `{ limited, fiveHour?, weekly? }` with each
 * window `{ used, cap, resetAt }` (`resetAt` in epoch ms, which the CLI compares with `Date.now()`). A plan
 * without window limits (`limited: false`) and a window without a positive cap yield no window.
 */
export function parseCommandCodeUsage(body: unknown): UsageWindow[] {
  const limits = isRecord(body) && isRecord(body.windowLimits) ? body.windowLimits : undefined
  if (!limits || limits.limited === false) return []
  return commandCodeWindows.flatMap((window) => {
    const value = limits[window.key]
    if (!isRecord(value) || !finite(value.used) || !finite(value.cap) || value.cap <= 0) return []
    const resetsAt = typeof value.resetAt === "string" ? Date.parse(value.resetAt) : value.resetAt
    return [
      {
        id: window.id,
        label: window.label,
        usedPercent: clamp((value.used / value.cap) * 100),
        ...(finite(resetsAt) ? { resetsAt } : {}),
      },
    ]
  })
}

/**
 * The Command Code API key, found the way its CLI finds it: `COMMAND_CODE_API_KEY`, then `apiKey` in
 * `~/.commandcode/auth.json` (home from `HOME`, then `USERPROFILE`). The key stays in the server process.
 */
export const readCommandCodeKey = (env: Readonly<Record<string, string | undefined>> = process.env) =>
  Effect.promise(async () => {
    const fromEnv = env.COMMAND_CODE_API_KEY?.trim()
    if (fromEnv) return fromEnv
    const home = env.HOME ?? env.USERPROFILE ?? os.homedir()
    const value = await readCredentialFile(path.join(home, ".commandcode", "auth.json"))
    return isRecord(value) && typeof value.apiKey === "string" && value.apiKey ? value.apiKey : undefined
  })

/**
 * Asks Command Code for its plan windows the way its `/usage` overlay does: `/alpha/whoami?limits=1` names the
 * account's organization, then `/alpha/billing/credits` (with `orgId` when there is one) returns `windowLimits`.
 * These are undocumented `/alpha` routes. The key goes only in the `Authorization` header.
 */
export const fetchCommandCodeUsage = (key: string, request: typeof fetch = fetch) =>
  Effect.tryPromise({
    try: async (signal): Promise<Result> => {
      const get = (route: string) =>
        request(`https://api.commandcode.ai${route}`, { headers: { Authorization: `Bearer ${key}` }, signal })
      const whoami = await get("/alpha/whoami?limits=1")
      if (whoami.status === 401 || whoami.status === 403)
        return { status: "signed-out", windows: [], reason: "Command Code sign-in has expired." }
      if (!whoami.ok) return { status: "error", windows: [], reason: `Usage request failed (HTTP ${whoami.status}).` }
      const account = await readBody(whoami)
      if (!account) return badBody
      const org = isRecord(account.value) && isRecord(account.value.org) ? account.value.org.id : undefined
      const credits = await get(
        typeof org === "string" && org
          ? `/alpha/billing/credits?${new URLSearchParams({ orgId: org }).toString()}`
          : "/alpha/billing/credits",
      )
      if (credits.status === 401 || credits.status === 403)
        return { status: "signed-out", windows: [], reason: "Command Code sign-in has expired." }
      if (!credits.ok) return { status: "error", windows: [], reason: `Usage request failed (HTTP ${credits.status}).` }
      const body = await readBody(credits)
      if (!body) return badBody
      return { status: "available", windows: parseCommandCodeUsage(body.value) }
    },
    catch: () => new Error("Could not reach api.commandcode.ai."),
  })

/** Whether an ACP command runs the Command Code CLI, by the names its npm package installs (`cmd` is left out: it is also Windows' shell). */
export function isCommandCode(command: string | undefined) {
  if (!command) return false
  const name = path
    .basename(command.replaceAll("\\", "/"))
    .toLowerCase()
    .replace(/\.(cmd|exe|ps1|mjs|js)$/, "")
  return ["command-code", "commandcode", "cmdc"].includes(name) || /node_modules[\\/]command-code[\\/]/i.test(command)
}

/**
 * Caches each instance's report for `ttl` milliseconds and reads the rest in parallel, each bounded by `timeout`,
 * so one slow harness never holds up the others. A failed or timed-out read becomes an `error` report.
 */
export function makeCache(options: { readonly ttl?: number; readonly timeout?: number } = {}) {
  const ttl = options.ttl ?? 60_000
  const timeout = options.timeout ?? 8_000
  const entries = new Map<string, UsageReport>()
  return (sources: ReadonlyArray<{ readonly instanceID: string; readonly read: Effect.Effect<Result, unknown> }>) =>
    Effect.forEach(
      sources,
      (source) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const cached = entries.get(source.instanceID)
          if (cached && now - cached.checkedAt < ttl) return cached
          const result = yield* source.read.pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () => Effect.succeed<Result>({ status: "error", windows: [], reason: "Usage check timed out." }),
            }),
            Effect.catchCause((cause) =>
              Effect.succeed<Result>({ status: "error", windows: [], reason: failureReason(cause) }),
            ),
          )
          const report: UsageReport = {
            instanceID: source.instanceID,
            ...result,
            checkedAt: yield* Clock.currentTimeMillis,
          }
          entries.set(source.instanceID, report)
          return report
        }),
      { concurrency: "unbounded" },
    )
}

export const unsupported = (reason: string): Result => ({ status: "unsupported", windows: [], reason })

function failureReason(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  return error instanceof Error && error.message ? error.message.slice(0, 200) : "Usage check failed."
}

function minutesLabel(minutes: number) {
  if (minutes === 10080) return "Weekly"
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

function clamp(value: number) {
  return Math.min(100, Math.max(0, value))
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

// Credential files are a few hundred bytes of JSON; anything bigger, or not a regular file, counts as missing.
const MAX_CREDENTIAL_BYTES = 64 * 1024
// Usage responses are small JSON documents; a larger or malformed body is reported as an error.
const MAX_BODY_BYTES = 256 * 1024

const badBody: Result = { status: "error", windows: [], reason: "Usage response was too large or not JSON." }

/** Parses a small JSON credential file, reading at most `MAX_CREDENTIAL_BYTES`. Never throws. */
async function readCredentialFile(file: string): Promise<unknown> {
  const handle = await fs.open(file, "r").catch(() => undefined)
  if (!handle) return undefined
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_CREDENTIAL_BYTES) return undefined
    // The file can grow after the stat, so the read itself stops one byte past the cap.
    const buffer = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1)
    const read = await handle.read(buffer, 0, buffer.length, 0)
    if (read.bytesRead > MAX_CREDENTIAL_BYTES) return undefined
    return Option.getOrUndefined(decodeJson(buffer.subarray(0, read.bytesRead).toString("utf8")))
  } catch {
    return undefined
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** Reads and parses a JSON response body of at most `MAX_BODY_BYTES`; `undefined` when it is larger or invalid. */
async function readBody(response: Response): Promise<{ readonly value: unknown } | undefined> {
  if (!response.body) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(chunk.value)
    }
  } catch {
    return undefined
  }
  const value = decodeJson(Buffer.concat(chunks).toString("utf8"))
  return Option.isSome(value) ? { value: value.value } : undefined
}
