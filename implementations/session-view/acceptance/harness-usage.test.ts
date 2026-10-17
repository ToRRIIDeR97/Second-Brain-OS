// Acceptance tests for harness-reported usage (AC-7).
// Setup once: the task folder needs a node_modules junction to opencode/packages/core/node_modules (see implementation.md).
// Run from opencode/packages/core:
//   bun test ../../../implementations/session-view/acceptance/harness-usage.test.ts
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { AcpHarness } from "../../../opencode/packages/core/src/harness/acp"
import { createLLMEventPublisher } from "../../../opencode/packages/core/src/session/runner/publish-llm-event"

const update = (value: Record<string, unknown>) => ({
  method: "session/update",
  params: { sessionId: "s1", update: value },
})

// The publisher only calls events.publish for content events; step-finish settles locally.
const events = { publish: () => Effect.void } as unknown as Parameters<typeof createLLMEventPublisher>[0]
const input = { sessionID: "ses_1", agent: "build", model: { id: "m", providerID: "p" } } as unknown as Parameters<
  typeof createLLMEventPublisher
>[1]

describe("AC-7 ACP usage_update reaches the step usage", () => {
  test("cost and context window from usage_update are attached to the step-finish usage", () => {
    const state = AcpHarness.acpState()
    const emitted = AcpHarness.parseAcpNotification(
      update({ sessionUpdate: "usage_update", used: 23200, size: 1000000, cost: { amount: 0.0331544, currency: "USD" } }),
      "s1",
      state,
    )
    expect(emitted).toEqual([])
    const finish = AcpHarness.finishAcpTurn(
      Exit.succeed({
        stopReason: "end_turn",
        usage: { inputTokens: 23120, outputTokens: 93, thoughtTokens: 81, cachedReadTokens: 80 },
      }),
      state,
    )
    const step = finish.find((event) => event.type === "step-finish")
    expect(step?.usage?.cacheReadInputTokens).toBe(80)
    expect(step?.usage?.providerMetadata).toMatchObject({
      harness: { cost: 0.0331544, contextUsed: 23200, contextSize: 1000000 },
    })
  })

  test("usage_update cost is cumulative, so a later turn reports only its own share", () => {
    const state = AcpHarness.acpState(0.02362878)
    AcpHarness.parseAcpNotification(
      update({ sessionUpdate: "usage_update", used: 23237, size: 1000000, cost: { amount: 0.02996566, currency: "USD" } }),
      "s1",
      state,
    )
    const finish = AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "end_turn" }), state)
    const harness = (finish.find((event) => event.type === "step-finish")?.usage?.providerMetadata as Record<string, any>)
      ?.harness
    expect(harness?.cost).toBeCloseTo(0.00633688, 8)
    expect(harness?.sessionCost).toBeCloseTo(0.02996566, 8)
  })

  test("ACP inputTokens excludes cache reads", () => {
    const state = AcpHarness.acpState()
    const finish = AcpHarness.finishAcpTurn(
      Exit.succeed({ stopReason: "end_turn", usage: { inputTokens: 39, outputTokens: 30, cachedReadTokens: 23198 } }),
      state,
    )
    const usage = finish.find((event) => event.type === "step-finish")?.usage
    expect(usage?.nonCachedInputTokens).toBe(39)
    expect(usage?.cacheReadInputTokens).toBe(23198)
    expect(usage?.inputTokens).toBe(23237)
  })

  test("a turn without usage_update carries no harness cost", () => {
    const state = AcpHarness.acpState()
    const finish = AcpHarness.finishAcpTurn(
      Exit.succeed({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 2 } }),
      state,
    )
    const step = finish.find((event) => event.type === "step-finish")
    expect((step?.usage?.providerMetadata as Record<string, any> | undefined)?.harness?.cost).toBeUndefined()
  })
})

describe("AC-7 the runner settles the step with the harness cost", () => {
  test("stepSettlement().cost comes from usage.providerMetadata.harness.cost", async () => {
    const publisher = createLLMEventPublisher(events, input)
    await Effect.runPromise(
      publisher.publish(
        LLMEvent.stepFinish({
          index: 0,
          reason: "stop",
          usage: { inputTokens: 10, outputTokens: 2, providerMetadata: { harness: { cost: 0.5 } } },
        }),
      ),
    )
    expect(publisher.stepSettlement()?.cost).toBe(0.5)
  })

  test("stepSettlement().cost is 0 when nothing reports a cost", async () => {
    const publisher = createLLMEventPublisher(events, input)
    await Effect.runPromise(
      publisher.publish(LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 10, outputTokens: 2 } })),
    )
    expect(publisher.stepSettlement()?.cost).toBe(0)
  })
})
