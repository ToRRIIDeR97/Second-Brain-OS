// Independent verification for AC-5, AC-6.
// Run from opencode/packages/app:
//   bun test ../../../implementations/session-view/verification/session-usage.verify.test.ts
import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { getSessionUsage } from "../../../opencode/packages/app/src/components/session/session-usage"

let seq = 0
function assistant(fields: { input?: number; output?: number; read?: number; write?: number; cost?: number; harness?: string }) {
  const message: Record<string, unknown> = {
    id: `m${++seq}`,
    sessionID: "s",
    role: "assistant",
    time: { created: seq },
    parentID: "u",
    modelID: "m",
    providerID: "p",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    tokens: {
      input: fields.input ?? 0,
      output: fields.output ?? 0,
      reasoning: 0,
      cache: { read: fields.read ?? 0, write: fields.write ?? 0 },
    },
  }
  if (fields.cost !== undefined) message.cost = fields.cost
  if (fields.harness) message.harnessInstanceID = fields.harness
  return message as unknown as Message
}

describe("AC-6 boundaries", () => {
  test("a fully cached turn has a 100% hit", () => {
    expect(getSessionUsage([assistant({ read: 5000, output: 3 })]).cacheHit).toBe(1)
  })

  test("free and paid turns mix: cost sums only what was reported", () => {
    const usage = getSessionUsage([assistant({ input: 1, cost: 0 }), assistant({ input: 1, cost: 0.006 })])
    expect(usage.cost).toBeCloseTo(0.006, 10)
  })
})

describe("AC-5 not-reported and filtering", () => {
  test("a message without a cost field counts as not reported", () => {
    expect(getSessionUsage([assistant({ input: 4, output: 1 })]).cost).toBeUndefined()
  })

  test("messages without a harness ID belong to the built-in harness", () => {
    const usage = getSessionUsage([assistant({ input: 9 }), assistant({ input: 100, harness: "codex" })], {
      harness: "opencode",
    })
    expect(usage.input).toBe(9)
  })

  test("a filter that matches nothing gives an empty result", () => {
    const usage = getSessionUsage([assistant({ input: 9, read: 9, cost: 1 })], { harness: "opencode-acp" })
    expect(usage).toMatchObject({ input: 0, cacheRead: 0 })
    expect(usage.cacheHit).toBeUndefined()
    expect(usage.cost).toBeUndefined()
  })
})
