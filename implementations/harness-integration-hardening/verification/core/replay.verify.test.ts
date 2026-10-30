import { describe, expect, test } from "bun:test"
import { Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { DateTime } from "effect"
import { ModelV2 } from "../../../../opencode/packages/core/src/model"
import { ProviderV2 } from "../../../../opencode/packages/core/src/provider"
import { SessionMessage } from "../../../../opencode/packages/core/src/session/message"
import { toLLMMessages } from "../../../../opencode/packages/core/src/session/runner/to-llm-message"

const created = DateTime.makeUnsafe(0)
const chat = Model.make({ id: "gpt", provider: "openai", route: OpenAIChat.route })

const turn = (content: SessionMessage.Assistant["content"]) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make("msg_codex"),
    type: "assistant",
    agent: "build",
    model: { id: ModelV2.ID.make("gpt-5"), providerID: ProviderV2.ID.make("codex") },
    content,
    time: { created, completed: created },
  })
const tool = (id: string, state: SessionMessage.AssistantTool["state"]) =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id,
    name: "command_execution",
    provider: { executed: true },
    state,
    time: { created, completed: created },
  })
const text = (parts: ReadonlyArray<{ type: string }>) =>
  parts.flatMap((part) => (part.type === "text" ? [(part as { text: string }).text] : [])).join("\n")

describe("verify AC-1 across providers", () => {
  test("Codex history replayed to OpenAI Chat has no tool parts, and failed tools say so", () => {
    const [message] = toLLMMessages(
      [
        turn([
          tool(
            "failed",
            SessionMessage.ToolStateError.make({
              status: "error",
              input: { command: "npm test" },
              content: [],
              structured: {},
              error: { type: "unknown", message: "exit 1" },
            }),
          ),
        ]),
      ],
      chat,
    )
    expect(message!.content.some((part) => part.type === "tool-call" || part.type === "tool-result")).toBe(false)
    expect(text(message!.content)).toContain("command_execution")
    expect(text(message!.content)).toContain("error")
  })

  test("long tool output is capped at 2,000 characters", () => {
    const [message] = toLLMMessages(
      [
        turn([
          tool(
            "long",
            SessionMessage.ToolStateCompleted.make({
              status: "completed",
              input: { command: "cat big.log" },
              // "q" appears nowhere in the tool name or command, so counting it measures only the output.
              content: [{ type: "text", text: "q".repeat(10_000) }],
              structured: {},
            }),
          ),
        ]),
      ],
      chat,
    )
    const replayed = text(message!.content)
    expect(replayed.length).toBeLessThan(2_500)
    expect(replayed.match(/q/g)?.length ?? 0).toBeLessThanOrEqual(2_000)
  })
})
