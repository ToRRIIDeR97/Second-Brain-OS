import { describe, expect, test } from "bun:test"
import { pricedCost } from "../src/session/runner/publish-llm-event"

const used = (input: number, output: number, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})

describe("step cost from catalog prices", () => {
  const base = { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }

  test("prices tokens per million and charges reasoning at the output rate", () => {
    // 1M input * $3 + (0.5M output + 0.5M reasoning) * $15 + 1M cache read * $0.30 = $18.30
    expect(pricedCost([base], used(1_000_000, 500_000, 500_000, 1_000_000))).toBeCloseTo(18.3)
  })

  test("uses the largest context tier the prompt exceeds", () => {
    const pricing = [base, { tier: { type: "context" as const, size: 200_000 }, input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 } }]
    expect(pricedCost(pricing, used(100_000, 0))).toBeCloseTo(0.3)
    expect(pricedCost(pricing, used(300_000, 0))).toBeCloseTo(1.8)
  })

  test("is zero without prices", () => {
    expect(pricedCost(undefined, used(1_000, 1_000))).toBe(0)
    expect(pricedCost([], used(1_000, 1_000))).toBe(0)
  })
})
