import { describe, expect, test } from "bun:test"
import {
  createGoogleAccessTokens,
  GOOGLE_OUTBOX_MAX_ATTEMPTS,
  googleEventId,
  googleEventPayload,
  googleHttpError,
  googleScopes,
  googleTaskPayload,
  nearestEvents,
  normalizeGoogleEvent,
  normalizeGoogleTask,
  outboxFailureState,
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

const config = { clientId: "id.apps.googleusercontent.com", clientSecret: "secret", refreshToken: "refresh-1" }

describe("Google Calendar domain", () => {
  test("uses PKCE, narrow scopes, stable IDs, and normalized event fields", () => {
    expect(pkceChallenge("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHijklmno")).toHaveLength(43)
    expect(googleScopes("read")).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/tasks.readonly",
    ])
    expect(googleScopes("write")).toHaveLength(3)
    expect(googleEventId("same-write")).toBe(googleEventId("same-write"))

    const event = normalizeGoogleEvent({
      id: "provider-1",
      summary: "Review",
      etag: "etag-1",
      start: { dateTime: "2026-08-25T09:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-08-25T10:00:00+08:00", timeZone: "Asia/Singapore" },
    })!
    expect(event).toMatchObject({ date: "2026-08-25", start: "09:00", end: "10:00", allDay: false })
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
    )!

    expect(task).toMatchObject({ taskListId: "list-1", dueDate: "2026-08-29", completedAt: expect.any(String) })
    expect(googleTaskPayload(task)).toMatchObject({
      due: "2026-08-29T00:00:00.000Z",
      status: "completed",
    })
  })

  test("uses inclusive dates locally and Google's exclusive all-day boundary", () => {
    const event = normalizeGoogleEvent({
      id: "provider-2",
      summary: "Conference",
      start: { date: "2026-08-25" },
      end: { date: "2026-08-28" },
    })!

    expect(event).toMatchObject({ date: "2026-08-25", endDate: "2026-08-27", allDay: true })
    expect(googleEventPayload(event)).toMatchObject({
      start: { date: "2026-08-25" },
      end: { date: "2026-08-28" },
    })
  })

  test("preserves the end date of an overnight timed event", () => {
    const event = normalizeGoogleEvent({
      id: "provider-3",
      start: { dateTime: "2026-08-25T23:00:00+08:00", timeZone: "Asia/Singapore" },
      end: { dateTime: "2026-08-26T01:00:00+08:00", timeZone: "Asia/Singapore" },
    })!

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

  test("hands a rotated refresh token to the store", async () => {
    const rotated: string[] = []
    const http = tokenFetch({ body: { access_token: "a1", refresh_token: "refresh-2", expires_in: 3600 } })
    const tokens = createGoogleAccessTokens({
      fetch: http.fetch,
      endpoint: "token",
      onRotate: (token) => rotated.push(token),
    })

    await tokens.get(config)
    expect(rotated).toEqual(["refresh-2"])
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
    const event = normalizeGoogleEvent(source, "Europe/Berlin")!
    expect(event.timezone).toBe("Europe/Berlin")
    const payload = googleEventPayload(event) as { start: { dateTime: string; timeZone: string } }
    expect(instant(payload.start.dateTime, payload.start.timeZone)).toBe(Date.parse(source.start.dateTime))
    // Without a requested zone the event's own zone is still used.
    expect(normalizeGoogleEvent(source)?.timezone).toBe("America/New_York")
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

  test("reports a 403 rate limit as retryable", () => {
    const limited = { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } }
    expect(googleHttpError(403, limited)).toBe("google_http_429")
    expect(googleHttpError(403, { error: { errors: [{ reason: "forbidden" }] } })).toBe("google_http_403")
    expect(googleHttpError(403, undefined)).toBe("google_http_403")
    expect(googleHttpError(500, limited)).toBe("google_http_500")
  })

  test("keeps transient failures queued until the attempt cap", () => {
    expect(outboxFailureState("google_conflict", 1)).toBe("conflict")
    expect(outboxFailureState("google_http_400", 1)).toBe("failed")
    expect(outboxFailureState("google_token_exchange_failed", 1)).toBe("offline")
    expect(outboxFailureState("google_token_exchange_failed", GOOGLE_OUTBOX_MAX_ATTEMPTS)).toBe("failed")
    expect(outboxFailureState("google_reconnect_required", GOOGLE_OUTBOX_MAX_ATTEMPTS + 1)).toBe("offline")
  })
})
