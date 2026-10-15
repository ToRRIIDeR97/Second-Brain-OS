// Independent verification for AC-7.
// Run from opencode/packages/core (needs the task folder's node_modules junction):
//   bun test ../../../implementations/session-view/verification/harness-usage.verify.test.ts
import { describe, expect, test } from "bun:test"
import { Exit } from "effect"
import { AcpHarness } from "../../../opencode/packages/core/src/harness/acp"

const update = (sessionId: string, value: Record<string, unknown>) => ({
  method: "session/update",
  params: { sessionId, update: value },
})

const harnessOf = (events: ReadonlyArray<{ type: string; usage?: { providerMetadata?: unknown } }>) =>
  (events.find((event) => event.type === "step-finish")?.usage?.providerMetadata as Record<string, any> | undefined)
    ?.harness

describe("AC-7 usage_update edge cases", () => {
  test("a usage_update for another session is ignored", () => {
    const state = AcpHarness.acpState()
    AcpHarness.parseAcpNotification(
      update("other", { sessionUpdate: "usage_update", used: 1, size: 2, cost: { amount: 9, currency: "USD" } }),
      "s1",
      state,
    )
    expect(harnessOf(AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "end_turn" }), state))?.cost).toBeUndefined()
  })

  test("a non-USD cost is not reported, but the context window still is", () => {
    const state = AcpHarness.acpState()
    AcpHarness.parseAcpNotification(
      update("s1", { sessionUpdate: "usage_update", used: 500, size: 8000, cost: { amount: 3, currency: "EUR" } }),
      "s1",
      state,
    )
    const harness = harnessOf(AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "end_turn" }), state))
    expect(harness?.cost).toBeUndefined()
    expect(harness).toMatchObject({ contextUsed: 500, contextSize: 8000 })
  })

  test("the last usage_update in a turn wins", () => {
    const state = AcpHarness.acpState(0.1)
    for (const amount of [0.12, 0.15])
      AcpHarness.parseAcpNotification(
        update("s1", { sessionUpdate: "usage_update", used: 10, size: 20, cost: { amount, currency: "USD" } }),
        "s1",
        state,
      )
    expect(harnessOf(AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "end_turn" }), state))?.cost).toBeCloseTo(
      0.05,
      10,
    )
  })

  test("a cumulative total below the previous one never gives a negative cost", () => {
    const state = AcpHarness.acpState(0.5)
    AcpHarness.parseAcpNotification(
      update("s1", { sessionUpdate: "usage_update", used: 10, size: 20, cost: { amount: 0.2, currency: "USD" } }),
      "s1",
      state,
    )
    const harness = harnessOf(AcpHarness.finishAcpTurn(Exit.succeed({ stopReason: "end_turn" }), state))
    expect(harness?.cost).toBe(0)
    expect(harness?.sessionCost).toBeCloseTo(0.2, 10)
  })

  test("a failed turn still ends without throwing", () => {
    const state = AcpHarness.acpState()
    const events = AcpHarness.finishAcpTurn(Exit.fail(new Error("boom") as never), state)
    expect(events.map((event) => event.type)).toContain("finish")
  })
})
