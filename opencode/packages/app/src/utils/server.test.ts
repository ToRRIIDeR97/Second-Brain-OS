import { describe, expect, test } from "bun:test"
import { Harness } from "@opencode-ai/schema/harness"
import {
  authFromToken,
  authTokenFromCredentials,
  createSessionForServer,
  fallbackHarnesses,
  listHarnessesForServer,
  switchHarnessForServer,
} from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("createSessionForServer", () => {
  test("sends the selected harness through the current session endpoint", async () => {
    let request: Request | undefined
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        request = new Request(input, init)
        return Response.json({ data: { id: "session-1" } })
      },
      { preconnect: globalThis.fetch.preconnect },
    )

    await createSessionForServer(
      { server: { url: "http://localhost:4096" }, fetch: fetcher },
      { harnessInstanceID: Harness.Codex },
    )

    expect(request).toBeDefined()
    expect(new URL(request!.url).pathname).toBe("/api/session")
    expect(await request!.json()).toEqual({ harnessInstanceID: Harness.Codex })
  })
})

describe("listHarnessesForServer", () => {
  test("keeps OpenCode usable when the server lacks harness discovery", () => {
    expect(fallbackHarnesses()).toEqual([
      expect.objectContaining({ id: Harness.OpenCode, status: "available" }),
      expect.objectContaining({ id: Harness.Codex, status: "unavailable" }),
    ])
  })

  test("decodes location-scoped harness snapshots", async () => {
    let request: Request | undefined
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        request = new Request(input, init)
        return Response.json({
          location: { directory: "C:\\repo", project: { id: "global", directory: "C:\\repo" } },
          data: [
            {
              id: "codex",
              driver: "codex",
              name: "Codex",
              status: "available",
              authenticated: true,
              models: [],
            },
          ],
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    )

    const harnesses = await listHarnessesForServer(
      { server: { url: "http://localhost:4096", username: "kit", password: "secret" }, fetch: fetcher },
      "C:\\repo",
    )

    expect(harnesses).toHaveLength(1)
    expect(harnesses[0]).toMatchObject({ id: Harness.Codex, authenticated: true })
    expect(new URL(request!.url).searchParams.get("location[directory]")).toBe("C:\\repo")
    expect(request!.headers.get("authorization")).toBe(`Basic ${btoa("kit:secret")}`)
  })
})

describe("switchHarnessForServer", () => {
  test("posts the selected harness and model to the session handoff endpoint", async () => {
    let request: Request | undefined
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        request = new Request(input, init)
        return new Response(null, { status: 204 })
      },
      { preconnect: globalThis.fetch.preconnect },
    )

    await switchHarnessForServer(
      { server: { url: "http://localhost:4096", username: "kit", password: "secret" }, fetch: fetcher },
      "session/1",
      { instanceID: Harness.Codex, model: { id: "gpt-5.6", reasoningEffort: "high" } },
    )

    expect(request).toBeDefined()
    expect(new URL(request!.url).pathname).toBe("/api/session/session%2F1/harness")
    expect(request!.headers.get("authorization")).toBe(`Basic ${btoa("kit:secret")}`)
    expect(await request!.json()).toEqual({
      instanceID: Harness.Codex,
      model: { id: "gpt-5.6", reasoningEffort: "high" },
    })
  })
})
