import { describe, expect, test } from "bun:test"
import {
  classifyGoogleError,
  createGoogleAccessTokens,
  GOOGLE_OUTBOX_MAX_ATTEMPTS,
  googleEventId,
  googleConnection,
  googleEventPayload,
  googleScopes,
  googleTaskPayload,
  nearestEvents,
  normalizeGoogleEvent,
  normalizeGoogleTask,
  outboxFailureState,
  migrateLegacyGoogleStore,
  pkceChallenge,
  pruneOutbox,
  requestGoogleToken,
  sanitizeProviderEvent,
  sanitizeProviderTask,
} from "./google-calendar-domain"

function tokenFetch(...responses: { status?: number; body: Record<string, unknown> }[]) {
  const requests: URLSearchParams[] = []
  const fetch = async (_input: string, init: RequestInit) => {
    requests.push(init.body instanceof URLSearchParams ? init.body : new URLSearchParams())
    const next = responses[Math.min(requests.length, responses.length) - 1]
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }
  return { fetch, requests }
}

const config = {
  accountId: "account-1",
  clientId: "id.apps.googleusercontent.com",
  clientSecret: "secret",
  refreshToken: "refresh-1",
}

describe("Google Calendar domain", () => {
  test("uses PKCE, narrow scopes, stable IDs, and normalized event fields", () => {
    expect(pkceChallenge("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHijklmno")).toHaveLength(43)
    expect(googleScopes("read")).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/tasks.readonly",
    ])
    expect(googleScopes("write")).toHaveLength(3)
    expect(googleEventId("same-write")).toBe(googleEventId("same-write"))

    const event = normalizeGoogleEvent(
      {
        id: "provider-1",
        summary: "Review",
        etag: "etag-1",
        start: { dateTime: "2026-08-25T09:00:00+08:00", timeZone: "Asia/Singapore" },
        end: { dateTime: "2026-08-25T10:00:00+08:00", timeZone: "Asia/Singapore" },
      },
      "account-1",
    )!
    expect(event).toMatchObject({
      accountId: "account-1",
      date: "2026-08-25",
      start: "09:00",
      end: "10:00",
      allDay: false,
    })
    expect(googleEventPayload(event)).toMatchObject({ start: { timeZone: "Asia/Singapore" } })
  })

  test("normalizes Google Tasks while keeping due dates date-only", () => {
    const task = normalizeGoogleTask(
      {
        id: "task-1",
        title: "Write summary",
        notes: "Keep this short",
        due: "2026-08-29T00:00:00.000Z",
        completed: "2026-08-28T04:00:00.000Z",
        status: "completed",
        updated: "2026-08-28T04:00:01.000Z",
        etag: "etag-task-1",
      },
      { id: "list-1", title: "Work" },
      "account-1",
    )!

    expect(task).toMatchObject({
      accountId: "account-1",
      taskListId: "list-1",
      dueDate: "2026-08-29",
      completedAt: expect.any(String),
    })
    expect(googleTaskPayload(task)).toMatchObject({
      due: "2026-08-29T00:00:00.000Z",
      status: "completed",
    })
  })

  test("uses inclusive dates locally and Google's exclusive all-day boundary", () => {
    const event = normalizeGoogleEvent(
      {
        id: "provider-2",
        summary: "Conference",
        start: { date: "2026-08-25" },
        end: { date: "2026-08-28" },
      },
      "account-1",
    )!

    expect(event).toMatchObject({ date: "2026-08-25", endDate: "2026-08-27", allDay: true })
    expect(googleEventPayload(event)).toMatchObject({
      start: { date: "2026-08-25" },
      end: { date: "2026-08-28" },
    })
  })

  test("preserves the end date of an overnight timed event", () => {
    const event = normalizeGoogleEvent(
      {
        id: "provider-3",
        start: { dateTime: "2026-08-25T23:00:00+08:00", timeZone: "Asia/Singapore" },
        end: { dateTime: "2026-08-26T01:00:00+08:00", timeZone: "Asia/Singapore" },
      },
      "account-1",
    )!

    expect(event.endDate).toBe("2026-08-26")
    expect(googleEventPayload(event)).toMatchObject({ end: { dateTime: "2026-08-26T01:00:00" } })
  })
})

describe("Google access tokens", () => {
  test("reuses one access token until it nearly expires", async () => {
    const clock = { now: 0 }
    const http = tokenFetch(
      { body: { access_token: "a1", expires_in: 3600 } },
      { body: { access_token: "a2", expires_in: 3600 } },
    )
    const tokens = createGoogleAccessTokens({
      fetch: http.fetch,
      endpoint: "token",
      onRotate: () => {},
      now: () => clock.now,
    })

    for (const _ of [1, 2, 3]) expect(await tokens.get(config)).toBe("a1")
    expect(http.requests).toHaveLength(1)

    clock.now += 3600_000 - 60_000
    expect(await tokens.get(config)).toBe("a2")
    expect(http.requests).toHaveLength(2)
  })

  test("renews a rejected cached token once before requiring a reconnect", async () => {
    const http = tokenFetch(
      { body: { access_token: "a1", expires_in: 3600 } },
      { body: { access_token: "a2", expires_in: 3600 } },
    )
    const tokens = createGoogleAccessTokens({ fetch: http.fetch, endpoint: "token", onRotate: () => {} })
    await tokens.get(config)

    const used: string[] = []
    const result = await tokens.with(config, async (token) => {
      used.push(token)
      if (token === "a1") throw new Error("google_reconnect_required")
      return "ok"
    })
    expect(result).toBe("ok")
    expect(used).toEqual(["a1", "a2"])
    expect(http.requests).toHaveLength(2)

    const rejected = tokens.with(config, async () => {
      throw new Error("google_reconnect_required")
    })
    expect(await rejected.catch(String)).toContain("google_reconnect_required")
    expect(http.requests).toHaveLength(3)
  })

  test("does not retry a freshly exchanged token or other errors", async () => {
    const http = tokenFetch({ body: { access_token: "a1", expires_in: 3600 } })
    const tokens = createGoogleAccessTokens({ fetch: http.fetch, endpoint: "token", onRotate: () => {} })
    let calls = 0
    const reconnect = tokens.with(config, async () => {
      calls++
      throw new Error("google_reconnect_required")
    })
    expect(await reconnect.catch(String)).toContain("google_reconnect_required")
    const conflict = tokens.with(config, async () => {
      calls++
      throw new Error("google_conflict")
    })
    expect(await conflict.catch(String)).toContain("google_conflict")
    expect(calls).toBe(2)
    expect(http.requests).toHaveLength(1)
  })

  test("keeps one token per account, even for accounts signed in through the same client", async () => {
    const http = tokenFetch(
      { body: { access_token: "a1", expires_in: 3600 } },
      { body: { access_token: "b1", expires_in: 3600 } },
      { body: { access_token: "a2", expires_in: 3600 } },
    )
    const tokens = createGoogleAccessTokens({ fetch: http.fetch, endpoint: "token", onRotate: () => {} })
    const other = { ...config, accountId: "account-2", refreshToken: "refresh-b" }

    expect(await tokens.get(config)).toBe("a1")
    expect(await tokens.get(other)).toBe("b1")
    expect(await tokens.get(config)).toBe("a1")
    expect(http.requests.map((request) => request.get("refresh_token"))).toEqual(["refresh-1", "refresh-b"])

    tokens.clear("account-1")
    expect(await tokens.get(other)).toBe("b1")
    expect(await tokens.get(config)).toBe("a2")
    expect(http.requests).toHaveLength(3)
  })

  test("hands a rotated refresh token to the store", async () => {
    const rotated: string[][] = []
    const http = tokenFetch({ body: { access_token: "a1", refresh_token: "refresh-2", expires_in: 3600 } })
    const tokens = createGoogleAccessTokens({
      fetch: http.fetch,
      endpoint: "token",
      onRotate: (accountId, token) => rotated.push([accountId, token]),
    })

    await tokens.get(config)
    expect(rotated).toEqual([["account-1", "refresh-2"]])
    expect(http.requests[0].get("refresh_token")).toBe("refresh-1")
  })

  test("maps invalid_grant on refresh to reconnect-required", async () => {
    const http = tokenFetch({ status: 400, body: { error: "invalid_grant" } })
    const tokens = createGoogleAccessTokens({ fetch: http.fetch, endpoint: "token", onRotate: () => {} })

    expect(await tokens.get(config).catch(String)).toContain("google_reconnect_required")
    const exchange = requestGoogleToken(http.fetch, "token", { grant_type: "authorization_code", code: "x" })
    expect(await exchange.catch(String)).toContain("google_token_exchange_failed")
  })
})

describe("Google items the planner accepts", () => {
  const base = {
    accountId: "account-1",
    providerId: "p1",
    calendarId: "primary",
    title: "Review",
    date: "2026-08-25",
    allDay: false,
    participantCount: 0,
  }

  test("cuts long titles and details and repairs same-day times that end before they start", () => {
    const event = sanitizeProviderEvent({
      ...base,
      title: ` ${"t".repeat(400)} `,
      details: "d".repeat(25_000),
      start: "10:00",
      end: "09:00",
    })
    expect([...event.title]).toHaveLength(300)
    expect([...(event.details ?? "")]).toHaveLength(20_000)
    expect(event).toMatchObject({ start: "10:00", end: "10:01" })
    expect(sanitizeProviderEvent({ ...base, start: "23:59", end: "23:59" })).toMatchObject({
      start: "23:58",
      end: "23:59",
    })
    // Across midnight is a valid range and stays as it is.
    expect(sanitizeProviderEvent({ ...base, endDate: "2026-08-26", start: "22:00", end: "00:00" })).toMatchObject({
      start: "22:00",
      end: "00:00",
    })
    expect(sanitizeProviderEvent({ ...base, title: "  " }).title).toBe("Untitled event")
  })

  test("cuts long task titles and notes", () => {
    const task = sanitizeProviderTask({
      accountId: "account-1",
      providerId: "t1",
      taskListId: "l1",
      taskListTitle: "List",
      title: "x".repeat(500),
      notes: "n".repeat(30_000),
      updatedAt: "2026-08-25T00:00:00.000Z",
    })
    expect(task.title).toHaveLength(300)
    expect(task.notes).toHaveLength(20_000)
  })

  test("keeps the events nearest to today when there are too many", () => {
    const events = ["2020-01-01", "2026-08-24", "2026-08-26", "2030-01-01"].map((date) => ({ date }))
    expect(nearestEvents(events, "2026-08-25", 2).map((event) => event.date)).toEqual(["2026-08-24", "2026-08-26"])
    expect(nearestEvents(events, "2026-08-25", 10)).toHaveLength(4)
  })

  test("a timed event keeps its instant through normalize and payload", () => {
    const source = {
      id: "provider-tz",
      summary: "Call",
      // Created in New York, rendered by Google in the requested Berlin zone.
      start: { dateTime: "2026-03-02T15:00:00+01:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-03-02T16:00:00+01:00", timeZone: "America/New_York" },
    }
    const event = normalizeGoogleEvent(source, "account-1", "Europe/Berlin")!
    expect(event.timezone).toBe("Europe/Berlin")
    const payload = googleEventPayload(event) as { start: { dateTime: string; timeZone: string } }
    expect(instant(payload.start.dateTime, payload.start.timeZone)).toBe(Date.parse(source.start.dateTime))
    // Without a requested zone the event's own zone is still used.
    expect(normalizeGoogleEvent(source, "account-1")?.timezone).toBe("America/New_York")
  })
})

/** The UTC instant of a wall-clock `YYYY-MM-DDTHH:mm:ss` time in an IANA zone. */
function instant(wall: string, timeZone: string) {
  const guess = Date.parse(`${wall}Z`)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(guess)
      .map((part) => [part.type, part.value]),
  )
  const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
  return guess - (local - guess)
}

describe("Google accounts", () => {
  test("moves a single-account store into one account and tags its queued writes", () => {
    const legacy: Record<string, unknown> = {
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "enc-secret",
      refreshToken: "enc-refresh",
      access: "write",
      accountLabel: "me@example.com",
      lastSyncedAt: "2026-10-01T00:00:00.000Z",
    }
    const migrated = migrateLegacyGoogleStore({
      read: (key) => legacy[key],
      id: "account-1",
      outbox: [{ id: "write-1" }, { id: "write-2", accountId: "account-0" }],
      taskOutbox: [{ id: "task-1" }],
    })!

    expect(migrated.account).toEqual({
      id: "account-1",
      email: "me@example.com",
      label: "me@example.com",
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "enc-secret",
      refreshToken: "enc-refresh",
      access: "write",
      lastSyncedAt: "2026-10-01T00:00:00.000Z",
    })
    expect(migrated.outbox.map((entry) => entry.accountId)).toEqual(["account-1", "account-0"])
    expect(migrated.taskOutbox[0].accountId).toBe("account-1")
    expect(
      migrateLegacyGoogleStore({
        read: (key) => (key === "clientId" ? "id" : undefined),
        id: "x",
        outbox: [],
        taskOutbox: [],
      }),
    ).toBeUndefined()
  })

  test("summarizes accounts for the page", () => {
    const account = (id: string, access: "read" | "write", lastSyncedAt?: string) => ({
      id,
      label: id,
      access,
      ...(lastSyncedAt ? { lastSyncedAt } : {}),
      pendingWrites: 1,
      failedWrites: 2,
    })
    const connection = googleConnection({
      configured: true,
      builtInClient: true,
      accounts: [account("a", "read", "2026-10-01T00:00:00.000Z"), account("b", "write", "2026-10-02T00:00:00.000Z")],
    })

    expect(connection).toMatchObject({
      connected: true,
      access: "write",
      accountLabel: "a",
      lastSyncedAt: "2026-10-02T00:00:00.000Z",
      pendingWrites: 2,
      failedWrites: 4,
    })
    expect(googleConnection({ configured: false, builtInClient: false, accounts: [] })).toMatchObject({
      connected: false,
      access: "read",
      accounts: [],
    })
  })
})

describe("Google outbox", () => {
  const entry = (id: string, state: "pending" | "offline" | "failed" | "conflict" | "succeeded") => ({ id, state })

  test("prunes succeeded entries first and never drops queued writes", () => {
    const entries = [entry("p1", "pending"), entry("f1", "failed"), entry("s1", "succeeded"), entry("o1", "offline")]
    expect(pruneOutbox(entries, 3).map((item) => item.id)).toEqual(["p1", "f1", "o1"])
    expect(pruneOutbox(entries, 2).map((item) => item.id)).toEqual(["p1", "o1"])
    expect(pruneOutbox(entries, 1).map((item) => item.id)).toEqual(["p1", "o1"])
    expect(pruneOutbox(entries, 4)).toBe(entries)
  })

  test("keeps timeouts, rate limits and server errors queued until the attempt cap", () => {
    for (const status of [408, 425, 429, 500, 502, 503]) {
      expect(outboxFailureState(`google_http_${status}`, 1)).toBe("offline")
      expect(outboxFailureState(`google_http_${status}`, GOOGLE_OUTBOX_MAX_ATTEMPTS)).toBe("failed")
    }
    for (const status of [400, 403, 404, 410]) expect(outboxFailureState(`google_http_${status}`, 1)).toBe("failed")
  })

  test("retries rate limits and fails at once when the user has to act", () => {
    const limited = JSON.stringify({ error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } })
    const code = classifyGoogleError(
      403,
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      limited,
    ).code
    expect(outboxFailureState(code, 1)).toBe("offline")
    expect(outboxFailureState("google_api_disabled_calendar", 1)).toBe("failed")
    expect(outboxFailureState("google_scope_missing", 1)).toBe("failed")
  })

  test("keeps transient failures queued until the attempt cap", () => {
    expect(outboxFailureState("google_conflict", 1)).toBe("conflict")
    expect(outboxFailureState("google_http_400", 1)).toBe("failed")
    expect(outboxFailureState("google_token_exchange_failed", 1)).toBe("offline")
    expect(outboxFailureState("google_token_exchange_failed", GOOGLE_OUTBOX_MAX_ATTEMPTS)).toBe("failed")
    expect(outboxFailureState("google_reconnect_required", GOOGLE_OUTBOX_MAX_ATTEMPTS + 1)).toBe("offline")
  })
})

describe("Google API errors", () => {
  const calendar = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  const tasks = "https://tasks.googleapis.com/tasks/v1/users/@me/lists"

  test("names the disabled API so the user knows which one to enable", () => {
    const body = JSON.stringify({
      error: {
        status: "PERMISSION_DENIED",
        errors: [{ reason: "accessNotConfigured" }],
        details: [{ reason: "SERVICE_DISABLED" }],
      },
    })
    expect(classifyGoogleError(403, tasks, body)).toEqual({
      code: "google_api_disabled_tasks",
      api: "tasks",
      reason: "SERVICE_DISABLED",
    })
    expect(classifyGoogleError(403, calendar, body).code).toBe("google_api_disabled_calendar")
  })

  test("recognizes missing scopes and rate limits", () => {
    const scope = JSON.stringify({ error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } })
    expect(classifyGoogleError(403, calendar, scope).code).toBe("google_scope_missing")
    expect(classifyGoogleError(429, calendar, "").code).toBe("google_rate_limited")
    const quota = JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } })
    expect(classifyGoogleError(403, calendar, quota).code).toBe("google_rate_limited")
  })

  test("keeps the status code otherwise and never returns free text as the reason", () => {
    expect(classifyGoogleError(409, calendar, "{}")).toEqual({
      code: "google_http_409",
      api: "calendar",
      reason: undefined,
    })
    expect(classifyGoogleError(500, tasks, "<html>oops</html>").code).toBe("google_http_500")
    const text = JSON.stringify({ error: { status: "Event 'Dentist' is invalid" } })
    expect(classifyGoogleError(400, calendar, text).reason).toBeUndefined()
  })
})
