import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HarnessUsage } from "@opencode-ai/core/harness/usage"
import { it } from "./lib/effect"

describe("parseClaudeUsage", () => {
  test("lists known windows in order with labels, clamped percents and ms reset times", () => {
    expect(
      HarnessUsage.parseClaudeUsage({
        seven_day_sonnet: { utilization: 12.5, resets_at: null },
        seven_day: { utilization: 140, resets_at: "2026-11-03T10:00:00.000Z" },
        five_hour: { utilization: -3, resets_at: "2026-10-29T15:30:00+00:00" },
        seven_day_opus: null,
      }),
    ).toEqual([
      { id: "five_hour", label: "5-hour", usedPercent: 0, resetsAt: Date.parse("2026-10-29T15:30:00Z") },
      { id: "seven_day", label: "Weekly", usedPercent: 100, resetsAt: Date.parse("2026-11-03T10:00:00Z") },
      { id: "seven_day_sonnet", label: "Weekly (Sonnet)", usedPercent: 12.5 },
    ])
  })

  test("labels unknown windows of the same shape from their key and skips other fields", () => {
    expect(
      HarnessUsage.parseClaudeUsage({
        seven_day_opus: { utilization: 50, resets_at: null },
        seven_day_oauth_apps: { utilization: 5, resets_at: "not a date" },
        extra_usage: { is_enabled: false, utilization: 10 },
        plan: "max",
      }),
    ).toEqual([
      { id: "seven_day_opus", label: "Weekly (Opus)", usedPercent: 50 },
      { id: "seven_day_oauth_apps", label: "Seven day oauth apps", usedPercent: 5 },
    ])
  })

  test("returns no windows for malformed input and never throws", () => {
    for (const body of [undefined, null, "text", 42, [], [{ utilization: 1 }], { five_hour: { utilization: "9" } }])
      expect(HarnessUsage.parseClaudeUsage(body)).toEqual([])
    expect(HarnessUsage.parseClaudeUsage({ five_hour: { utilization: Number.NaN, resets_at: null } })).toEqual([])
  })
})

describe("parseCodexRateLimits", () => {
  test("reads primary then secondary with window labels, clamping and ms reset times", () => {
    expect(
      HarnessUsage.parseCodexRateLimits({
        rateLimits: {
          secondary: { usedPercent: 120, windowDurationMins: 10080, resetsAt: 1_762_000_000 },
          primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_761_750_000 },
        },
      }),
    ).toEqual([
      { id: "primary", label: "5-hour", usedPercent: 42, resetsAt: 1_761_750_000_000, windowMinutes: 300 },
      { id: "secondary", label: "Weekly", usedPercent: 100, resetsAt: 1_762_000_000_000, windowMinutes: 10080 },
    ])
  })

  test("labels other lengths in hours or minutes and falls back to Primary/Secondary", () => {
    expect(
      HarnessUsage.parseCodexRateLimits({
        rateLimits: {
          primary: { usedPercent: -1, windowDurationMins: 90, resetsAt: null },
          secondary: { usedPercent: 3, windowDurationMins: 120 },
        },
      }),
    ).toEqual([
      { id: "primary", label: "90-minute", usedPercent: 0, windowMinutes: 90 },
      { id: "secondary", label: "2-hour", usedPercent: 3, windowMinutes: 120 },
    ])
    expect(
      HarnessUsage.parseCodexRateLimits({
        rateLimits: { primary: { usedPercent: 7, windowDurationMins: null }, secondary: { usedPercent: 8 } },
      }),
    ).toEqual([
      { id: "primary", label: "Primary", usedPercent: 7 },
      { id: "secondary", label: "Secondary", usedPercent: 8 },
    ])
  })

  test("returns no windows for malformed input and never throws", () => {
    for (const body of [
      undefined,
      null,
      "x",
      {},
      { rateLimits: null },
      { rateLimits: [] },
      { rateLimits: { primary: null, secondary: { usedPercent: "5" } } },
    ])
      expect(HarnessUsage.parseCodexRateLimits(body)).toEqual([])
  })
})

describe("readClaudeToken", () => {
  const configDir = async (credentials?: unknown) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-usage-"))
    if (credentials !== undefined) await fs.writeFile(path.join(dir, ".credentials.json"), JSON.stringify(credentials))
    return dir
  }
  const read = (dir: string, now = 1_000) =>
    Effect.runPromise(HarnessUsage.readClaudeToken({ CLAUDE_CONFIG_DIR: dir }, now))

  test("reports a missing file, a missing token, or unreadable JSON as missing", async () => {
    expect(await read(await configDir())).toEqual({ status: "missing" })
    expect(await read(await configDir({ claudeAiOauth: {} }))).toEqual({ status: "missing" })
    const broken = await configDir()
    await fs.writeFile(path.join(broken, ".credentials.json"), "{")
    expect(await read(broken)).toEqual({ status: "missing" })
  })

  test("reports an expired token without returning it", async () => {
    const result = await read(await configDir({ claudeAiOauth: { accessToken: "tok-old", expiresAt: 999 } }))
    expect(result).toEqual({ status: "expired" })
  })

  test("returns a valid token", async () => {
    expect(await read(await configDir({ claudeAiOauth: { accessToken: "tok-1", expiresAt: 5_000 } }))).toEqual({
      status: "valid",
      token: "tok-1",
    })
  })
})

describe("fetchClaudeUsage", () => {
  test("sends the token only in the Authorization header and parses the windows", async () => {
    const calls: { url: string; headers: Headers }[] = []
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) })
      return Response.json({ five_hour: { utilization: 20, resets_at: null } })
    }) as typeof fetch
    const result = await Effect.runPromise(HarnessUsage.fetchClaudeUsage("tok-1", request))
    expect(result).toEqual({ status: "available", windows: [{ id: "five_hour", label: "5-hour", usedPercent: 20 }] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("https://api.anthropic.com/api/oauth/usage")
    expect(calls[0]!.url).not.toContain("tok-1")
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer tok-1")
    expect(calls[0]!.headers.get("anthropic-beta")).toBe("oauth-2025-04-20")
  })

  test("maps a rejected token to signed-out and other failures to errors without the token", async () => {
    const status = (code: number) => (async () => new Response("{}", { status: code })) as unknown as typeof fetch
    expect((await Effect.runPromise(HarnessUsage.fetchClaudeUsage("tok-1", status(401)))).status).toBe("signed-out")
    const failed = await Effect.runPromise(HarnessUsage.fetchClaudeUsage("tok-1", status(500)))
    expect(failed).toEqual({ status: "error", windows: [], reason: "Usage request failed (HTTP 500)." })
    const offline = (async () => {
      throw new Error("connect failed tok-1")
    }) as unknown as typeof fetch
    const error = await Effect.runPromise(Effect.flip(HarnessUsage.fetchClaudeUsage("tok-1", offline)))
    expect(error.message).toBe("Could not reach api.anthropic.com.")
  })
})

describe("usage cache", () => {
  const available = (percent: number): HarnessUsage.Result => ({
    status: "available",
    windows: [{ id: "primary", label: "Primary", usedPercent: percent }],
  })

  it.effect("serves a report from cache for a minute and reads it again afterwards", () =>
    Effect.gen(function* () {
      const cache = HarnessUsage.makeCache()
      let reads = 0
      const source = { instanceID: "codex", read: Effect.sync(() => available(++reads)) }
      const first = yield* cache([source])
      yield* TestClock.adjust("59 seconds")
      expect(yield* cache([source])).toEqual(first)
      expect(reads).toBe(1)
      yield* TestClock.adjust("1 second")
      const fresh = yield* cache([source])
      expect(reads).toBe(2)
      expect(fresh[0]!.windows[0]!.usedPercent).toBe(2)
      expect(fresh[0]!.checkedAt).toBe(first[0]!.checkedAt + 60_000)
    }),
  )

  it.effect("times out one slow harness without holding up the others", () =>
    Effect.gen(function* () {
      const cache = HarnessUsage.makeCache()
      const fiber = yield* cache([
        { instanceID: "slow", read: Effect.never },
        { instanceID: "codex", read: Effect.succeed(available(10)) },
        { instanceID: "claude-code", read: Effect.succeed<HarnessUsage.Result>({ status: "signed-out", windows: [] }) },
      ]).pipe(Effect.forkChild)
      yield* TestClock.adjust("8 seconds")
      expect(yield* Fiber.join(fiber)).toEqual([
        { instanceID: "slow", status: "error", windows: [], reason: "Usage check timed out.", checkedAt: 8_000 },
        { instanceID: "codex", ...available(10), checkedAt: 0 },
        { instanceID: "claude-code", status: "signed-out", windows: [], checkedAt: 0 },
      ])
    }),
  )

  it.effect("turns a failed or crashed read into an error report", () =>
    Effect.gen(function* () {
      const cache = HarnessUsage.makeCache()
      const reports = yield* cache([
        { instanceID: "a", read: Effect.fail(new Error("Codex process failed.")) },
        { instanceID: "b", read: Effect.die("boom") },
      ])
      expect(reports.map((report) => [report.status, report.reason])).toEqual([
        ["error", "Codex process failed."],
        ["error", "Usage check failed."],
      ])
    }),
  )
})
