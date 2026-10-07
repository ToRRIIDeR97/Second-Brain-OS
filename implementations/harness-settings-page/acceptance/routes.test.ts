// Worker-visible acceptance tests for the harness settings HTTP routes.
// Run from opencode/packages/opencode (its preload isolates XDG_CONFIG_HOME):
//   bun test --timeout 30000 ../../../Implementations/harness-settings-page/acceptance/routes.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Context } from "effect"
import { HttpApiApp } from "../../../opencode/packages/opencode/src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../../../opencode/packages/opencode/test/fixture/db"
import { disposeAllInstances, tmpdir } from "../../../opencode/packages/opencode/test/fixture/fixture"

const fixture = path.resolve(import.meta.dir, "../fixtures/fake-acp-agent.ts")
const context = Context.empty() as Context.Context<unknown>
const registryFile = () => path.join(process.env.XDG_CONFIG_HOME!, "opencode", "harnesses.json")

async function call(directory: string, method: string, route: string, body?: unknown) {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set("location[directory]", directory)
  const response = await HttpApiApp.webHandler().handler(
    new Request(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    context,
  )
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined }
}

const fake = (id: string, scenario = "models") => ({
  id,
  name: `Fake ${id}`,
  command: process.execPath,
  args: [fixture, scenario],
})

beforeEach(async () => {
  await fs.rm(registryFile(), { force: true })
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
  await fs.rm(registryFile(), { force: true })
})

describe("Harness settings routes acceptance", () => {
  test("AC-8 GET /api/harness/settings lists built-ins as read-only", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await call(dir.path, "GET", "/api/harness/settings")
    expect(result.status).toBe(200)
    const ids = result.body.data.map((entry: any) => entry.id)
    expect(ids).toContain("opencode")
    expect(ids).toContain("codex")
    expect(result.body.data.find((entry: any) => entry.id === "codex")).toMatchObject({
      source: "built-in",
      editable: false,
    })
  })

  test("AC-8 POST /api/harness/registry adds a harness that the picker lists without a restart", async () => {
    await using dir = await tmpdir({ git: true })
    const added = await call(dir.path, "POST", "/api/harness/registry", fake("fake"))
    expect(added.status).toBe(200)
    expect(added.body.data).toMatchObject({
      id: "fake",
      source: "registry",
      editable: true,
      enabled: true,
    })

    const listed = await call(dir.path, "GET", "/api/harness")
    expect(listed.status).toBe(200)
    expect(listed.body.data.find((item: any) => item.id === "fake")).toMatchObject({ status: "available" })
  })

  test("AC-8 PATCH disables a harness and the picker reports it unavailable", async () => {
    await using dir = await tmpdir({ git: true })
    await call(dir.path, "POST", "/api/harness/registry", fake("fake"))
    const patched = await call(dir.path, "PATCH", "/api/harness/registry/fake", { enabled: false })
    expect(patched.status).toBe(200)
    expect(patched.body.data).toMatchObject({ id: "fake", enabled: false })

    const listed = await call(dir.path, "GET", "/api/harness")
    expect(listed.body.data.find((item: any) => item.id === "fake")).toMatchObject({ status: "unavailable" })
  })

  test("AC-8 DELETE removes a harness from settings and the picker", async () => {
    await using dir = await tmpdir({ git: true })
    await call(dir.path, "POST", "/api/harness/registry", fake("fake"))
    const removed = await call(dir.path, "DELETE", "/api/harness/registry/fake")
    expect(removed.status).toBe(200)

    const settings = await call(dir.path, "GET", "/api/harness/settings")
    expect(settings.body.data.some((entry: any) => entry.id === "fake")).toBe(false)
    const listed = await call(dir.path, "GET", "/api/harness")
    expect(listed.body.data.some((item: any) => item.id === "fake")).toBe(false)
  })

  test("AC-8 POST /api/harness/discover returns models without saving", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await call(dir.path, "POST", "/api/harness/discover", {
      command: process.execPath,
      args: [fixture, "config-options"],
    })
    expect(result.status).toBe(200)
    expect(result.body.data.models.map((model: any) => model.id)).toEqual(["fake-a", "fake-b"])
    const settings = await call(dir.path, "GET", "/api/harness/settings")
    expect(settings.body.data.map((entry: any) => entry.id)).toEqual(["opencode", "codex"])
  })

  test("AC-9 errors map to status codes with a typed reason", async () => {
    await using dir = await tmpdir({ git: true })
    const reserved = await call(dir.path, "POST", "/api/harness/registry", {
      ...fake("x"),
      id: "codex",
    })
    expect(reserved.status).toBe(400)
    expect(reserved.body.reason).toBe("reserved")

    await call(dir.path, "POST", "/api/harness/registry", fake("fake"))
    const duplicate = await call(dir.path, "POST", "/api/harness/registry", fake("fake"))
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.reason).toBe("exists")

    const missing = await call(dir.path, "DELETE", "/api/harness/registry/ghost")
    expect(missing.status).toBe(404)
    expect(missing.body.reason).toBe("not-found")

    const notAcp = await call(dir.path, "POST", "/api/harness/registry", fake("bad", "not-acp"))
    expect(notAcp.status).toBe(400)
    expect(notAcp.body.reason).toBe("probe-failed")
  })
})
