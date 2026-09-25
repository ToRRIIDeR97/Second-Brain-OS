import { expect, test } from "bun:test"
import { createSessionContextFormatter } from "./session-context-format"

test("formats numeric and ISO timestamps", () => {
  const format = createSessionContextFormatter("en-US").time

  expect(format(1_788_192_299_525)).not.toBe("—")
  expect(format("2026-08-31T16:18:19.525Z")).not.toBe("—")
})
