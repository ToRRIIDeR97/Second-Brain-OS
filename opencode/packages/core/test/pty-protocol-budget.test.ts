import { expect, test } from "bun:test"
import { PtyProtocol } from "../src/pty/protocol"

test("pending PTY output closes once past the limit, then drops", () => {
  const budget = PtyProtocol.pendingBudget(10)
  expect(budget.admit("12345")).toBe("send")
  expect(budget.admit(new Uint8Array(5))).toBe("send")
  expect(budget.admit("x")).toBe("close")
  expect(budget.admit("y")).toBe("drop")

  const draining = PtyProtocol.pendingBudget(10)
  expect(draining.admit("12345678")).toBe("send")
  draining.sent("12345678")
  // Sent output no longer counts, so a client that keeps up is never closed.
  expect(draining.admit("1234567890")).toBe("send")
})
