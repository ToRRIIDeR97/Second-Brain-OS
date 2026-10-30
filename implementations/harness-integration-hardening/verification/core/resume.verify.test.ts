import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { openCodexThread } from "../../../../opencode/packages/core/src/harness"
import { ProtocolError } from "../../../../opencode/packages/core/src/harness/codex-app-server"

describe("verify AC-4 Codex thread setup", () => {
  test("without a continuation only thread/start is requested", async () => {
    const calls: string[] = []
    const result = await Effect.runPromise(
      openCodexThread(
        {
          request: (method: string) => {
            calls.push(method)
            return Effect.succeed({ thread: { id: "thr_1" } })
          },
        },
        undefined,
        {},
      ),
    )
    expect(calls).toEqual(["thread/start"])
    expect(result.resumed).toBe(false)
  })

  test("when the fallback start also fails, that error is returned", async () => {
    const error = await Effect.runPromise(
      openCodexThread(
        {
          request: (method: string) =>
            Effect.fail(new ProtocolError(method === "thread/start" ? "start refused" : "did not answer thread/resume")),
        },
        "thr_old",
        {},
      ).pipe(Effect.flip),
    )
    expect(error.message).toBe("start refused")
  })
})
