import { describe, expect, test } from "bun:test"
import type { GoogleCalendarPlatform } from "@/context/platform"
import { calendarSync, syncGoogleCalendar } from "./calendar-sync"

const connection = {
  available: true,
  configured: true,
  connected: true,
  access: "read" as const,
  pendingWrites: 0,
  failedWrites: 0,
  accounts: [{ id: "a1", label: "Work", access: "read" as const, pendingWrites: 0, failedWrites: 0 }],
}

function setup() {
  const writes: unknown[] = []
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        writes.push(body)
        return Response.json({ version: 2, revision: "r2", events: body.events, tasks: body.tasks })
      }
      expect(String(input)).toContain("/second-brain/calendar")
      return Response.json({ version: 2, revision: "r1", events: [], tasks: [] })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const client = { server: { http: { url: "http://localhost:4096" } }, fetch, target: { directory: "C:\\brain" } }
  return { writes, client: client as unknown as Parameters<typeof syncGoogleCalendar>[0]["client"] }
}

describe("syncGoogleCalendar", () => {
  test("reads the calendar, merges Google events, and writes against its revision", async () => {
    const { writes, client } = setup()
    const google = {
      sync: async () => ({
        events: [
          {
            accountId: "a1",
            providerId: "e1",
            calendarId: "primary",
            title: "Standup",
            date: "2026-11-02",
            state: "synced" as const,
            task: null,
          },
        ],
        tasks: [],
        syncedAccounts: ["a1"],
        connection,
      }),
    } as unknown as GoogleCalendarPlatform
    const before = calendarSync.version()

    const result = await syncGoogleCalendar({ google, client })

    expect(result?.saved.revision).toBe("r2")
    expect(writes).toMatchObject([{ expectedRevision: "r1", events: [{ title: "Standup" }] }])
    expect(calendarSync.version()).toBe(before + 1)
    expect(calendarSync.lastSynced()).toBeGreaterThan(0)
  })

  test("skips while another Google call runs", async () => {
    const { client } = setup()
    let release = () => {}
    const google = {
      sync: () =>
        new Promise((resolve) => {
          release = () => resolve({ events: [], tasks: [], syncedAccounts: [], connection })
        }),
    } as unknown as GoogleCalendarPlatform

    const first = syncGoogleCalendar({ google, client })
    expect(await syncGoogleCalendar({ google, client })).toBeUndefined()
    release()
    expect(await first).toBeDefined()
    expect(calendarSync.busy()).toBe(false)
  })
})
