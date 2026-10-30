import { describe, expect, test } from "bun:test"
import { Model } from "@opencode-ai/llm"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import { DateTime } from "effect"
import { ModelV2 } from "../../../../opencode/packages/core/src/model"
import { ProviderV2 } from "../../../../opencode/packages/core/src/provider"
import { SessionMessage } from "../../../../opencode/packages/core/src/session/message"
import { toLLMMessages } from "../../../../opencode/packages/core/src/session/runner/to-llm-message"

const created = DateTime.makeUnsafe(0)
const anthropic = Model.make({ id: "claude", provider: "anthropic", route: AnthropicMessages.route })

const harnessTurn = (providerID: string) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make("msg_harness"),
    type: "assistant",
    agent: "build",
    model: { id: ModelV2.ID.make("claude"), providerID: ProviderV2.ID.make(providerID) },
    content: [
      SessionMessage.AssistantText.make({ type: "text", id: "t", text: "Ran the tests." }),
      SessionMessage.AssistantTool.make({
        type: "tool",
        id: "call_1",
        name: "acp_execute",
        provider: { executed: true },
        state: SessionMessage.ToolStateCompleted.make({
          status: "completed",
          input: { command: "bun test" },
          content: [{ type: "text", text: "12 pass" }],
          structured: {},
        }),
        time: { created, completed: created },
      }),
    ],
    time: { created, completed: created },
  })

describe("AC-1 provider-executed tool history across providers", () => {
  test("a harness turn replayed to the built-in agent becomes text, not server-tool parts", () => {
    const [message] = toLLMMessages([harnessTurn("claude-code")], anthropic)
    const parts = message!.content
    expect(parts.some((part) => part.type === "tool-call" || part.type === "tool-result")).toBe(false)
    const text = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    expect(text).toContain("Ran the tests.")
    expect(text).toContain("acp_execute")
    expect(text).toContain("completed")
    expect(text).toContain("12 pass")
  })

  test("the same provider still gets provider-executed call and result parts", () => {
    const [message] = toLLMMessages([harnessTurn("anthropic")], anthropic)
    const types = message!.content.map((part) => part.type)
    expect(types).toContain("tool-call")
    expect(types).toContain("tool-result")
  })
})
