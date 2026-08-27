import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Harness } from "../src/harness"

describe("Harness.InstanceID", () => {
  test("accepts the built-in harness instances", () => {
    expect(Schema.decodeUnknownSync(Harness.InstanceID)("opencode")).toBe(Harness.OpenCode)
    expect(Schema.decodeUnknownSync(Harness.InstanceID)("codex")).toBe(Harness.Codex)
  })

  test("preserves well-formed instance IDs for drivers added by newer builds", () => {
    expect(String(Schema.decodeUnknownSync(Harness.InstanceID)("harness_x"))).toBe("harness_x")
  })

  test("rejects malformed instance IDs at the wire boundary", () => {
    expect(() => Schema.decodeUnknownSync(Harness.InstanceID)("harness x")).toThrow()
  })

  test("decodes discovered model capabilities", () => {
    const instance = Schema.decodeUnknownSync(Harness.Instance)({
      id: "codex-work",
      driver: "codex",
      name: "Work Codex",
      status: "available",
      authenticated: true,
      models: [
        {
          id: "gpt-5.6",
          name: "GPT-5.6",
          reasoningEfforts: ["medium", "high"],
          serviceTiers: [{ id: "priority", name: "Priority" }],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
    })

    expect(instance.models[0]).toMatchObject({ id: "gpt-5.6", defaultReasoningEffort: "medium" })
  })
})
