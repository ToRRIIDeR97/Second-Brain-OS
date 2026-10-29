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

const claudeLabels: Record<string, string> = {
  five_hour: "5-hour",
  seven_day: "Weekly",
  seven_day_opus: "Weekly (Opus)",
  seven_day_sonnet: "Weekly (Sonnet)",
}

/**
 * Reads Anthropic's OAuth usage response: `{ five_hour: { utilization, resets_at } | null, seven_day: ..., ... }`.
 * Known windows come first in a fixed order, then any other key with the same shape. Malformed input yields `[]`.
 */
export function parseClaudeUsage(body: unknown): UsageWindow[] {
  if (!isRecord(body)) return []
  const known = Object.keys(claudeLabels).filter((key) => key in body)
  const other = Object.keys(body).filter((key) => !(key in claudeLabels))
  return [...known, ...other].flatMap((key) => {
    const value = body[key]
    // Other keys count only with the window shape, so fields like `extra_usage` are skipped.
    if (!isRecord(value) || !finite(value.utilization) || !(key in claudeLabels || "resets_at" in value)) return []
    const resetsAt = typeof value.resets_at === "string" ? Date.parse(value.resets_at) : Number.NaN
    return [
      {
        id: key,
        label: claudeLabels[key] ?? keyLabel(key),
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
      const value = Option.getOrUndefined(
        decodeJson(await fs.readFile(path.join(dir, ".credentials.json"), "utf8").catch(() => "")),
      )
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
      return { status: "available", windows: parseClaudeUsage(await response.json().catch(() => undefined)) }
    },
    catch: () => new Error("Could not reach api.anthropic.com."),
  })

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
  if (minutes === 300) return "5-hour"
  if (minutes === 10080) return "Weekly"
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

function keyLabel(key: string) {
  const words = key.split("_").filter(Boolean).join(" ")
  return words ? words[0]!.toUpperCase() + words.slice(1) : key
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
