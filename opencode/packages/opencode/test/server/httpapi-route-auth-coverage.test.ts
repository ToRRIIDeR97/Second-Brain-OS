import { afterAll, describe, expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApi } from "effect/unstable/httpapi"
import { OpenCodeHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

// Operations that are reachable without the server credential on purpose. Keep this list short
// and justify every entry.
const PUBLIC = new Set<string>([])

function operations() {
  const result: Array<{ method: string; path: string }> = []
  HttpApi.reflect(OpenCodeHttpApi, {
    onGroup: () => {},
    onEndpoint: (input) => result.push({ method: input.endpoint.method, path: input.endpoint.path }),
  })
  return result
}

afterAll(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi route authorization coverage", () => {
  test("every declared operation rejects requests without credentials", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const handler = HttpRouter.toWebHandler(
      HttpApiApp.routes.pipe(
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: "secret" }))),
      ),
      { disableLogger: true },
    ).handler
    const all = operations()
    expect(all.length).toBeGreaterThan(100)

    const open: string[] = []
    for (const operation of all) {
      const key = `${operation.method} ${operation.path}`
      if (PUBLIC.has(key)) continue
      const url = new URL(operation.path.replace(/:(\w+)/g, "x"), "http://localhost")
      const response = await handler(
        new Request(url, {
          method: operation.method,
          headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
          body: operation.method === "GET" || operation.method === "HEAD" ? undefined : "{}",
        }),
        HttpApiApp.context,
      )
      await response.body?.cancel().catch(() => {})
      if (response.status !== 401) open.push(`${key} -> ${response.status}`)
    }
    expect(open).toEqual([])
  })
})
