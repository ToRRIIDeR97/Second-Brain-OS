import { describe, expect, test } from "bun:test"
import { LLM, Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { idleRuntimeKeys, renderCodexInstructions, renderHarnessPrompt } from "../../../../opencode/packages/core/src/harness"
import { AcpHarness } from "../../../../opencode/packages/core/src/harness/acp"

const minute = 60_000

describe("AC-19 idle harness runtimes are closed", () => {
  test("only runtimes idle past the limit with no turn running", () => {
    const activity = new Map([
      ["codex:s1:0", { lastUsed: 0, busy: 0 }],
      ["codex:s2:0", { lastUsed: 25 * minute, busy: 0 }],
      ["claude-code:s3:0", { lastUsed: 0, busy: 1 }],
    ])
    expect(idleRuntimeKeys(activity, 40 * minute, 30 * minute)).toEqual(["codex:s1:0"])
  })
})

describe("AC-21 a reopened ACP session doesn't count its whole cost again", () => {
  test("the last replayed usage cost is the baseline", () => {
    const update = (value: Record<string, unknown>) => ({ method: "session/update", params: { sessionId: "s", update: value } })
    expect(
      AcpHarness.replayedCost([
        update({ sessionUpdate: "usage_update", cost: { amount: 1.5, currency: "USD" } }),
        update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } }),
        update({ sessionUpdate: "usage_update", cost: { amount: 2.25, currency: "USD" } }),
      ]),
    ).toBe(2.25)
  })
})

describe("AC-22 Codex gets AGENTS.md once and no skill-tool guidance", () => {
  const request = LLM.request({
    model: Model.make({ id: "gpt", provider: "test", route }),
    system: [
      { type: "text", text: "You are a coding agent." },
      {
        type: "text",
        text: [
          "Instructions from: /w/AGENTS.md\nUse tabs.",
          "Skills provide specialized instructions and workflows for specific tasks.\nUse the skill tool to load a skill when a task matches its description.\n<available_skills>\n  <skill>\n    <name>x</name>\n    <description>d</description>\n  </skill>\n</available_skills>",
        ].join("\n\n"),
      },
    ],
    prompt: "Hi",
  })

  test("developer instructions keep AGENTS.md and drop the skill block", () => {
    const text = renderCodexInstructions(request)
    expect(text).toContain("Instructions from: /w/AGENTS.md\nUse tabs.")
    expect(text).not.toContain("available_skills")
    expect(text).not.toContain("skill tool")
  })

  test("a Codex handoff's context block has no agents-md copy", () => {
    const codex = renderHarnessPrompt(request, "full", { instructionsInDeveloper: true })
    expect(codex).not.toContain("<agents-md")
    const acp = renderHarnessPrompt(request, "full", {})
    expect(acp).toContain("<agents-md")
  })
})
