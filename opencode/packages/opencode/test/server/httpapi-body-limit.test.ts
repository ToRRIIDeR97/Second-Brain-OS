import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { ControlPaths } from "../../src/server/routes/instance/httpapi/groups/control"
import { MAX_BODY_BYTES } from "../../src/server/routes/instance/httpapi/middleware/body-limit"
import { resetDatabase } from "../fixture/db"

let listener: Awaited<ReturnType<typeof Server.listen>>

beforeAll(async () => {
  listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
})

afterAll(async () => {
  await listener.stop(true)
  await resetDatabase()
})

const post = (body: BodyInit) =>
  fetch(new URL(ControlPaths.log, listener.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    // @ts-expect-error Bun and Node need duplex for streamed request bodies.
    duplex: "half",
  })

const logBody = (message: string, extra?: Record<string, unknown>) =>
  JSON.stringify({ service: "body-limit-test", level: "debug", message, extra })

describe("HttpApi request body limit", () => {
  test("accepts a large log entry and caps it in the handler", async () => {
    const response = await post(logBody("x".repeat(200_000), { blob: "y".repeat(200_000) }))
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  test("rejects a body whose declared length exceeds the limit", async () => {
    const response = await post(logBody("x".repeat(MAX_BODY_BYTES)))
    await response.body?.cancel()
    expect(response.status).toBe(413)
  })

  test("stops buffering a streamed body without content-length past the limit", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024 * 1024))
    const sent = { count: 0 }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"service":"s","level":"debug","message":"'))
      },
      pull(controller) {
        // A valid JSON body, so only the size limit can reject it.
        if (sent.count++ <= MAX_BODY_BYTES / chunk.length) return controller.enqueue(chunk)
        controller.enqueue(new TextEncoder().encode('"}'))
        controller.close()
      },
    })
    const response = await post(stream)
    await response.body?.cancel()
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})
