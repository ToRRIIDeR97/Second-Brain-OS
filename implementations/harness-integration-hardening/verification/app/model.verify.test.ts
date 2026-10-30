import { describe, expect, test } from "bun:test"
import { reconcileHarnessModel } from "../../../../opencode/packages/app/src/components/prompt-input/harness-controller"

const harness = (driver: string, models: string[]) =>
  ({
    id: "h",
    driver,
    status: "available",
    models: models.map((id) => ({ id, name: id, isDefault: false })),
  }) as never

describe("verify AC-5 model reconciliation", () => {
  test("a running turn keeps the model even when the list lacks it", () => {
    expect(reconcileHarnessModel({ selected: harness("acp", ["a"]), current: { id: "b" }, running: true })).toEqual({
      keep: true,
    })
  })

  test("a listed model is kept", () => {
    expect(reconcileHarnessModel({ selected: harness("codex", ["a", "b"]), current: { id: "b" }, running: false })).toEqual(
      { keep: true },
    )
  })

  test("the built-in loop clears a harness model", () => {
    expect(reconcileHarnessModel({ selected: harness("opencode", []), current: { id: "b" }, running: false })).toEqual({
      set: undefined,
    })
  })

  test("nothing to clear on the built-in loop is a keep", () => {
    expect(reconcileHarnessModel({ selected: harness("opencode", []), current: undefined, running: false })).toEqual({
      keep: true,
    })
  })
})
