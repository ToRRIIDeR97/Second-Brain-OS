import { describe, expect, test } from "bun:test"
import { Harness } from "@opencode-ai/schema/harness"
import {
  authFromToken,
  authTokenFromCredentials,
  createSessionForServer,
  fallbackHarnesses,
  listHarnessesForServer,
  listHarnessesRemembered,
  listSkillCatalog,
  rememberedHarnesses,
  setSkillEnabled,
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
  test("keeps the Tenon Workbench loop usable when the server lacks harness discovery", () => {
    expect(fallbackHarnesses()).toEqual([
      expect.objectContaining({ id: Harness.OpenCode, name: "Default agent", status: "available" }),
      expect.objectContaining({ id: Harness.Codex, status: "unavailable" }),
      expect.objectContaining({ id: Harness.OpenCodeAcp, driver: Harness.AcpDriver, status: "unavailable" }),
      expect.objectContaining({ id: Harness.ClaudeCode, driver: Harness.AcpDriver, status: "unavailable" }),
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

describe("listHarnessesRemembered", () => {
  test("keeps the last good list and never a failed check", async () => {
    const codex = { id: Harness.Codex, driver: Harness.CodexDriver, name: "Codex", status: "available", models: [] }
    let ok = true
    const fetcher = Object.assign(
      async () =>
        ok
          ? Response.json({
              location: { directory: "C:\\brain", project: { id: "p", directory: "C:\\brain" } },
              data: [codex],
            })
          : new Response(null, { status: 500 }),
      { preconnect: globalThis.fetch.preconnect },
    )
    const input = { server: { url: "http://localhost:4097" }, fetch: fetcher }

    expect(rememberedHarnesses("http://localhost:4097", "C:\\brain")).toBeUndefined()
    await listHarnessesRemembered(input, "C:\\brain")
    expect(rememberedHarnesses("http://localhost:4097", "C:\\brain")).toMatchObject([{ id: Harness.Codex }])

    ok = false
    expect(await listHarnessesRemembered(input, "C:\\brain")).toMatchObject([{ id: Harness.Codex }])
    expect(rememberedHarnesses("http://localhost:4097", "C:\\brain")).toMatchObject([{ id: Harness.Codex }])
    // Availability doesn't depend on the folder, so a new folder starts from the server's latest list.
    expect(rememberedHarnesses("http://localhost:4097", "C:\\other")).toMatchObject([{ id: Harness.Codex }])
    expect(rememberedHarnesses("http://localhost:4098", "C:\\other")).toBeUndefined()
    await expect(
      listHarnessesRemembered({ ...input, server: { url: "http://localhost:4098" } }, "C:\\x"),
    ).rejects.toThrow()
  })

  test("hands only a good list to the persisted copy", async () => {
    const codex = { id: Harness.Codex, driver: Harness.CodexDriver, name: "Codex", status: "available", models: [] }
    let ok = true
    const fetcher = Object.assign(
      async () =>
        ok
          ? Response.json({
              location: { directory: "C:\\kept", project: { id: "p", directory: "C:\\kept" } },
              data: [codex],
            })
          : new Response(null, { status: 500 }),
      { preconnect: globalThis.fetch.preconnect },
    )
    const input = { server: { url: "http://localhost:4097" }, fetch: fetcher }
    const kept: unknown[] = []

    await listHarnessesRemembered(input, "C:\\kept", (list) => kept.push(list))
    ok = false
    await listHarnessesRemembered(input, "C:\\kept", (list) => kept.push(list))

    expect(kept).toMatchObject([[{ id: Harness.Codex }]])
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

describe("listSkillCatalog", () => {
  test("reads the location-scoped skills catalog", async () => {
    let request: Request | undefined
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        request = new Request(input, init)
        return Response.json({
          location: { directory: "/repo", project: { id: "global", directory: "/repo" } },
          data: {
            tenon: [{ name: "notes", location: "/t/notes/SKILL.md", scope: "global" }],
            harnesses: [{ id: "codex", name: "Codex", source: "none", skills: [] }],
          },
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    )

    const catalog = await listSkillCatalog({ server: { url: "http://localhost:4096/" }, fetch: fetcher }, "/repo")

    expect(catalog.tenon.map((skill) => skill.name)).toEqual(["notes"])
    expect(catalog.harnesses[0]).toMatchObject({ id: "codex", source: "none" })
    expect(new URL(request!.url).pathname).toBe("/api/skill/catalog")
    expect(new URL(request!.url).searchParams.get("location[directory]")).toBe("/repo")
  })

  test("surfaces the server's failure message", async () => {
    const fetcher = Object.assign(async () => Response.json({ message: "Nope" }, { status: 500 }), {
      preconnect: globalThis.fetch.preconnect,
    })
    await expect(
      listSkillCatalog({ server: { url: "http://localhost:4096" }, fetch: fetcher }, "/repo"),
    ).rejects.toThrow("Nope")
  })
})

describe("setSkillEnabled", () => {
  test("posts the switch to the location-scoped route", async () => {
    let request: Request | undefined
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        request = new Request(input, init)
        return Response.json({
          location: { directory: "/repo", project: { id: "global", directory: "/repo" } },
          data: { name: "notes", enabled: false },
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    )

    const result = await setSkillEnabled(
      { server: { url: "http://localhost:4096" }, fetch: fetcher },
      "/repo",
      "notes",
      false,
    )

    expect(result).toEqual({ name: "notes", enabled: false })
    expect(request!.method).toBe("POST")
    expect(new URL(request!.url).pathname).toBe("/api/skill/enabled")
    expect(new URL(request!.url).searchParams.get("location[directory]")).toBe("/repo")
    expect(await request!.json()).toEqual({ name: "notes", enabled: false })
  })
})
