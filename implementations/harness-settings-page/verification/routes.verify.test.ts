// Independent verification tests for the harness settings HTTP routes.
// Run from opencode/packages/opencode:
//   bun test --timeout 30000 ../../../Implementations/harness-settings-page/verification/routes.verify.test.ts
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

describe("Harness settings routes verification", () => {
  test("AC-9 harnesses defined in a project config file are read-only through the routes", async () => {
    await using dir = await tmpdir({
      git: true,
      init: async (directory) => {
        await fs.writeFile(
          path.join(directory, "opencode.json"),
          JSON.stringify({
            harnesses: {
              projectcli: {
                driver: "acp",
                config: { command: process.execPath },
              },
            },
          }),
        )
      },
    })
    const settings = await call(dir.path, "GET", "/api/harness/settings")
    expect(settings.body.data.find((entry: any) => entry.id === "projectcli")).toMatchObject({
      source: "config",
      editable: false,
    })
    const patched = await call(dir.path, "PATCH", "/api/harness/registry/projectcli", { enabled: false })
    expect(patched.status).toBe(400)
    expect(patched.body.reason).toBe("read-only")
    const removed = await call(dir.path, "DELETE", "/api/harness/registry/projectcli")
    expect(removed.status).toBe(400)
    expect(removed.body.reason).toBe("read-only")
  })

  test("AC-8 an added harness survives an instance restart", async () => {
    await using dir = await tmpdir({ git: true })
    expect((await call(dir.path, "POST", "/api/harness/registry", fake("persist"))).status).toBe(200)
    await disposeAllInstances()
    const settings = await call(dir.path, "GET", "/api/harness/settings")
    expect(settings.body.data.find((entry: any) => entry.id === "persist")).toMatchObject({ source: "registry" })
  })

  test("AC-8 re-enabling a disabled harness makes the picker report it available again", async () => {
    await using dir = await tmpdir({ git: true })
    await call(dir.path, "POST", "/api/harness/registry", fake("toggle"))
    await call(dir.path, "PATCH", "/api/harness/registry/toggle", {
      enabled: false,
    })
    const enabled = await call(dir.path, "PATCH", "/api/harness/registry/toggle", { enabled: true })
    expect(enabled.body.data).toMatchObject({ enabled: true })
    const listed = await call(dir.path, "GET", "/api/harness")
    expect(listed.body.data.find((item: any) => item.id === "toggle")).toMatchObject({ status: "available" })
  })

  test("AC-9 a malformed request body is rejected with 400 and writes nothing", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await call(dir.path, "POST", "/api/harness/registry", {
      id: "nocommand",
    })
    expect(result.status).toBe(400)
    await expect(fs.access(registryFile())).rejects.toThrow()
  })

  test("AC-9 a failed probe during add writes nothing", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await call(dir.path, "POST", "/api/harness/registry", fake("broken", "not-acp"))
    expect(result.status).toBe(400)
    expect(result.body.reason).toBe("probe-failed")
    await expect(fs.access(registryFile())).rejects.toThrow()
  })

  test("AC-9 an invalid ID is rejected before anything runs", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await call(dir.path, "POST", "/api/harness/registry", fake("1-bad id"))
    expect(result.status).toBe(400)
    expect(result.body.reason).toBe("invalid-id")
  })
})
