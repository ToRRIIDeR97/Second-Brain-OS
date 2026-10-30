import { describe, expect, test } from "bun:test"
import { LLM, Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { idleRuntimeKeys, renderCodexInstructions } from "../../../../opencode/packages/core/src/harness"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"

describe("verify AC-19", () => {
  test("exactly at the limit is not idle; an empty map gives nothing", () => {
    expect(idleRuntimeKeys(new Map([["k", { lastUsed: 0, busy: 0 }]]), 1_000, 1_000)).toEqual([])
    expect(idleRuntimeKeys(new Map(), 10, 1)).toEqual([])
  })
})

describe("verify AC-21", () => {
  test("no usage update, or a non-USD one, gives no baseline", () => {
    const update = (value: Record<string, unknown>) => ({ method: "session/update", params: { sessionId: "s", update: value } })
    expect(AcpHarness.replayedCost([update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } })])).toBeUndefined()
    expect(AcpHarness.replayedCost([update({ sessionUpdate: "usage_update", cost: { amount: 3, currency: "EUR" } })])).toBeUndefined()
    expect(AcpHarness.replayedCost([])).toBeUndefined()
  })
})

describe("verify AC-22", () => {
  test("an empty skill list and a reference block are dropped; text around them stays", () => {
    const request = LLM.request({
      model: Model.make({ id: "gpt", provider: "test", route }),
      system: [
        {
          type: "text",
          text: [
            "Before.",
            "Skills provide specialized instructions and workflows for specific tasks.\nUse the skill tool to load a skill when a task matches its description.\nNo skills are currently available.",
            "Project references provide additional directories that can be accessed when relevant.\n<available_references>\n  <reference>\n    <name>docs</name>\n    <path>/d</path>\n  </reference>\n</available_references>",
            "After.",
          ].join("\n\n"),
        },
      ],
      prompt: "Hi",
    })
    const text = renderCodexInstructions(request)
    expect(text).toContain("Before.")
    expect(text).toContain("After.")
    expect(text).not.toContain("No skills are currently available")
    expect(text).not.toContain("available_references")
  })
})
