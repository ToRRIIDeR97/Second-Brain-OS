// Acceptance tests for session-wide usage (AC-5, AC-6).
// Run from opencode/packages/app:
//   bun test ../../../implementations/session-view/acceptance/session-usage.test.ts
import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { getSessionUsage } from "../../../opencode/packages/app/src/components/session/session-usage"

let seq = 0
function assistant(
  tokens: { input: number; output: number; reasoning?: number; read?: number; write?: number },
  cost = 0,
  harnessInstanceID?: string,
) {
  return {
    id: `msg_${++seq}`,
    sessionID: "ses_1",
    role: "assistant",
    time: { created: seq },
    parentID: "msg_user",
    modelID: "m",
    providerID: "p",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning ?? 0,
      cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 },
    },
    ...(harnessInstanceID ? { harnessInstanceID } : {}),
  } as unknown as Message
}

const user = { id: "msg_user", sessionID: "ses_1", role: "user", time: { created: 0 } } as unknown as Message

describe("AC-6 session totals", () => {
  test("sums tokens across assistant messages and ignores user messages", () => {
    const usage = getSessionUsage([
      user,
      assistant({ input: 100, output: 20, reasoning: 5, read: 300, write: 50 }),
      assistant({ input: 50, output: 10, read: 500 }),
    ])
    expect(usage.input).toBe(150)
    expect(usage.output).toBe(30)
    expect(usage.reasoning).toBe(5)
    expect(usage.cacheRead).toBe(800)
    expect(usage.cacheWrite).toBe(50)
  })

  test("cache hit is cache reads over all input-side tokens", () => {
    const usage = getSessionUsage([assistant({ input: 100, output: 1, read: 800, write: 100 })])
    expect(usage.cacheHit).toBeCloseTo(0.8, 10)
  })

  test("cost is the sum of reported costs", () => {
    const usage = getSessionUsage([assistant({ input: 1, output: 1 }, 0.25), assistant({ input: 1, output: 1 }, 0.17)])
    expect(usage.cost).toBeCloseTo(0.42, 10)
  })
})

describe("AC-5 values that are not reported stay undefined", () => {
  test("cost is undefined when no assistant message reported one", () => {
    const usage = getSessionUsage([assistant({ input: 10, output: 2 }), assistant({ input: 5, output: 1 })])
    expect(usage.cost).toBeUndefined()
  })

  test("an empty session has zero tokens and no cache hit or cost", () => {
    const usage = getSessionUsage([])
    expect(usage).toMatchObject({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
    expect(usage.cacheHit).toBeUndefined()
    expect(usage.cost).toBeUndefined()
  })

  test("a harness filter only counts that harness's messages", () => {
    const messages = [
      assistant({ input: 100, output: 10 }, 0, "codex"),
      assistant({ input: 7, output: 3 }, 0.01, "opencode-acp"),
    ]
    const usage = getSessionUsage(messages, { harness: "opencode-acp" })
    expect(usage.input).toBe(7)
    expect(usage.output).toBe(3)
    expect(usage.cost).toBeCloseTo(0.01, 10)
  })
})
