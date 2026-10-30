import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { openCodexThread } from "../../../../opencode/packages/core/src/harness"
import { ProtocolError } from "../../../../opencode/packages/core/src/harness/codex-app-server"

const client = (resume: () => Effect.Effect<unknown, ProtocolError>) => {
  const calls: string[] = []
  return {
    calls,
    client: {
      request: (method: string, _params?: unknown) => {
        calls.push(method)
        if (method === "thread/resume") return resume()
        return Effect.succeed({ thread: { id: "thr_new" } })
      },
    },
  }
}

describe("AC-4 Codex resume falls back to a new thread on any error", () => {
  test("an unrecognised resume error starts a new thread", async () => {
    const fake = client(() => Effect.fail(new ProtocolError("rollout file is corrupt")))
    const result = await Effect.runPromise(openCodexThread(fake.client, "thr_old", { cwd: "/w" }))
    expect(result.resumed).toBe(false)
    expect(fake.calls).toEqual(["thread/resume", "thread/start"])
  })

  test("a successful resume does not start a thread", async () => {
    const fake = client(() => Effect.succeed({ thread: { id: "thr_old" } }))
    const result = await Effect.runPromise(openCodexThread(fake.client, "thr_old", { cwd: "/w" }))
    expect(result.resumed).toBe(true)
    expect(fake.calls).toEqual(["thread/resume"])
  })
})
