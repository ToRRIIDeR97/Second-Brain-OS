import { describe, expect, test } from "bun:test"
import { reconcileHarnessModel } from "../../../../opencode/packages/app/src/components/prompt-input/harness-controller"

const acp = (models: string[]) =>
  ({
    id: "claude-code",
    driver: "acp",
    status: "available",
    models: models.map((id, index) => ({ id, name: id, isDefault: index === 0 })),
  }) as never

describe("AC-5 the thread's model is kept while a harness's models load", () => {
  test("an empty model list keeps the current model", () => {
    expect(reconcileHarnessModel({ selected: acp([]), current: { id: "opus" }, running: false })).toEqual({ keep: true })
  })

  test("a list without the current model resets to the harness default", () => {
    expect(reconcileHarnessModel({ selected: acp(["sonnet", "haiku"]), current: { id: "opus" }, running: false })).toEqual({
      set: { id: "sonnet" },
    })
  })
})
