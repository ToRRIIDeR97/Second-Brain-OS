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

  test("treats an oversized file or a directory at the path as missing", async () => {
    const big = await configDir()
    await fs.writeFile(
      path.join(big, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "tok-1", padding: "x".repeat(70 * 1024) } }),
    )
    expect(await read(big)).toEqual({ status: "missing" })
    const folder = await configDir()
    await fs.mkdir(path.join(folder, ".credentials.json"))
    expect(await read(folder)).toEqual({ status: "missing" })
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

  test("reports an oversized or non-JSON body from either service as an error", async () => {
    const body = (text: string) => (async () => new Response(text)) as unknown as typeof fetch
    const huge = JSON.stringify({ five_hour: { utilization: 1, resets_at: null }, pad: "x".repeat(300 * 1024) })
    const bad: HarnessUsage.Result = {
      status: "error",
      windows: [],
      reason: "Usage response was too large or not JSON.",
    }
    expect(await Effect.runPromise(HarnessUsage.fetchClaudeUsage("tok-1", body(huge)))).toEqual(bad)
    expect(await Effect.runPromise(HarnessUsage.fetchClaudeUsage("tok-1", body("<html>")))).toEqual(bad)
    expect(await Effect.runPromise(HarnessUsage.fetchCommandCodeUsage("cc-key", body(huge)))).toEqual(bad)
    expect(await Effect.runPromise(HarnessUsage.fetchCommandCodeUsage("cc-key", body("not json")))).toEqual(bad)
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

describe("parseCommandCodeUsage", () => {
  test("reads the 5-hour then weekly window as a clamped share of its cap with ms reset times", () => {
    expect(
      HarnessUsage.parseCommandCodeUsage({
        credits: { monthlyCredits: 10 },
        windowLimits: {
          limited: true,
          weekly: { used: 150, cap: 100, resetAt: 1_762_000_000_000 },
          fiveHour: { used: 5, cap: 20, resetAt: "2026-10-29T15:30:00Z" },
        },
      }),
    ).toEqual([
      { id: "five_hour", label: "5-hour", usedPercent: 25, resetsAt: Date.parse("2026-10-29T15:30:00Z") },
      { id: "weekly", label: "Weekly", usedPercent: 100, resetsAt: 1_762_000_000_000 },
    ])
    expect(
      HarnessUsage.parseCommandCodeUsage({ windowLimits: { fiveHour: { used: -4, cap: 8, resetAt: null } } }),
    ).toEqual([{ id: "five_hour", label: "5-hour", usedPercent: 0 }])
  })

  test("skips windows without a positive cap and plans without window limits", () => {
    expect(
      HarnessUsage.parseCommandCodeUsage({
        windowLimits: { limited: true, fiveHour: { used: 1, resetAt: 5 }, weekly: { used: 1, cap: 0 } },
      }),
    ).toEqual([])
    expect(
      HarnessUsage.parseCommandCodeUsage({ windowLimits: { limited: false, fiveHour: { used: 1, cap: 2 } } }),
    ).toEqual([])
  })

  test("returns no windows for malformed input and never throws", () => {
    for (const body of [
      undefined,
      null,
      "x",
      [],
      { windowLimits: null },
      { windowLimits: [] },
      { windowLimits: { fiveHour: { used: "1", cap: 2 }, weekly: "full" } },
    ])
      expect(HarnessUsage.parseCommandCodeUsage(body)).toEqual([])
  })
})

describe("readCommandCodeKey", () => {
  const home = async (auth?: unknown) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-usage-cmd-"))
    if (auth !== undefined) {
      await fs.mkdir(path.join(dir, ".commandcode"))
      await fs.writeFile(path.join(dir, ".commandcode", "auth.json"), JSON.stringify(auth))
    }
    return dir
  }

  test("finds no key without the variable or an auth file key", async () => {
    expect(await Effect.runPromise(HarnessUsage.readCommandCodeKey({ HOME: await home() }))).toBeUndefined()
    expect(
      await Effect.runPromise(HarnessUsage.readCommandCodeKey({ HOME: await home({ userName: "me" }) })),
    ).toBeUndefined()
  })

  test("treats an oversized auth file or a directory at the path as no key", async () => {
    const big = await home({ apiKey: "file-key", padding: "x".repeat(70 * 1024) })
    expect(await Effect.runPromise(HarnessUsage.readCommandCodeKey({ HOME: big }))).toBeUndefined()
    const folder = await home()
    await fs.mkdir(path.join(folder, ".commandcode", "auth.json"), { recursive: true })
    expect(await Effect.runPromise(HarnessUsage.readCommandCodeKey({ HOME: folder }))).toBeUndefined()
  })

  test("prefers COMMAND_CODE_API_KEY over the auth file, which it falls back to", async () => {
    const dir = await home({ apiKey: "file-key" })
    expect(await Effect.runPromise(HarnessUsage.readCommandCodeKey({ HOME: dir }))).toBe("file-key")
    expect(await Effect.runPromise(HarnessUsage.readCommandCodeKey({ USERPROFILE: dir }))).toBe("file-key")
    expect(
      await Effect.runPromise(HarnessUsage.readCommandCodeKey({ HOME: dir, COMMAND_CODE_API_KEY: " env-key " })),
    ).toBe("env-key")
    expect(await Effect.runPromise(HarnessUsage.readCommandCodeKey({ HOME: dir, COMMAND_CODE_API_KEY: "  " }))).toBe(
      "file-key",
    )
  })
})

describe("fetchCommandCodeUsage", () => {
  test("sends the key only in the Authorization header and reads the organization's windows", async () => {
    const calls: { url: string; headers: Headers }[] = []
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) })
      if (String(url).includes("/alpha/whoami")) return Response.json({ org: { id: "org_1" } })
      return Response.json({ windowLimits: { limited: true, weekly: { used: 3, cap: 12, resetAt: 9 } } })
    }) as typeof fetch
    const result = await Effect.runPromise(HarnessUsage.fetchCommandCodeUsage("cc-key", request))
    expect(result).toEqual({
      status: "available",
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 25, resetsAt: 9 }],
    })
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.commandcode.ai/alpha/whoami?limits=1",
      "https://api.commandcode.ai/alpha/billing/credits?orgId=org_1",
    ])
    for (const call of calls) {
      expect(call.url).not.toContain("cc-key")
      expect(call.headers.get("authorization")).toBe("Bearer cc-key")
    }
  })

  test("reads a personal account without orgId and maps a rejected key to signed-out", async () => {
    const urls: string[] = []
    const personal = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return Response.json(String(url).includes("whoami") ? { user: { userName: "me" } } : {})
    }) as typeof fetch
    expect(await Effect.runPromise(HarnessUsage.fetchCommandCodeUsage("cc-key", personal))).toEqual({
      status: "available",
      windows: [],
    })
    expect(urls[1]).toBe("https://api.commandcode.ai/alpha/billing/credits")
    const rejected = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch
    expect((await Effect.runPromise(HarnessUsage.fetchCommandCodeUsage("cc-key", rejected))).status).toBe("signed-out")
  })

  test("recognizes Command Code commands by the names its package installs", () => {
    for (const command of [
      "command-code",
      "commandcode",
      "cmdc",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\command-code.cmd",
      "/usr/local/lib/node_modules/command-code/dist/index.mjs",
    ])
      expect(HarnessUsage.isCommandCode(command)).toBe(true)
    for (const command of [undefined, "", "cmd", "cmd.exe", "opencode", "claude-agent-acp"])
      expect(HarnessUsage.isCommandCode(command)).toBe(false)
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
