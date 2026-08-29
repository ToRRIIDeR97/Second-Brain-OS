import { describe, expect, test } from "bun:test"
import { LLM, Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { codexState, parseCodexNotification, renderCodexPrompt } from "@opencode-ai/core/harness"

describe("Codex harness", () => {
  test("maps assistant and provider-executed tool items", () => {
    const state = codexState()
    const command = parseCodexNotification(
      {
        method: "item/completed",
        params: {
          item: { id: "tool_1", type: "commandExecution", command: "git status", aggregatedOutput: "clean" },
        },
      },
      state,
    )
    const message = parseCodexNotification(
      { method: "item/completed", params: { item: { id: "message_1", type: "agentMessage", text: "Done" } } },
      state,
    )

    expect(command.map((event) => event.type)).toEqual(["tool-call", "tool-result"])
    expect(command[0]).toMatchObject({ providerExecuted: true, input: { command: "git status" } })
    expect(message.map((event) => event.type)).toEqual(["text-start", "text-delta", "text-end"])
  })

  test("normalizes turn usage and completes the stream", () => {
    const state = codexState()
    parseCodexNotification(
      {
        method: "thread/tokenUsage/updated",
        params: {
          tokenUsage: {
            last: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningOutputTokens: 5 },
          },
        },
      },
      state,
    )
    const events = parseCodexNotification(
      { method: "turn/completed", params: { turn: { id: "turn_1", status: "completed" } } },
      state,
    )

    expect(state.finished).toBe(true)
    expect(events[0]).toMatchObject({
      type: "step-finish",
      usage: { inputTokens: 100, nonCachedInputTokens: 60, cacheReadInputTokens: 40, outputTokens: 20 },
    })
  })

  test("renders only the latest user turn for a persistent Codex thread", () => {
    const prompt = renderCodexPrompt(
      LLM.request({
        model: Model.make({ id: "gpt-test", provider: "test", route }),
        system: "Stay within the workspace.",
        messages: [
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Old" }).messages[0]!,
          { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] },
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Latest" })
            .messages[0]!,
        ],
      }),
    )

    expect(prompt).toContain("Latest")
    expect(prompt).not.toContain("Old")
    expect(prompt).not.toContain("Earlier answer")
  })

  test("renders canonical history when handing a Run to a fresh Codex thread", () => {
    const prompt = renderCodexPrompt(
      LLM.request({
        model: Model.make({ id: "gpt-test", provider: "test", route }),
        messages: [
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Old" }).messages[0]!,
          { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] },
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Latest" })
            .messages[0]!,
        ],
      }),
      true,
    )

    expect(prompt).toContain("USER:\nOld")
    expect(prompt).toContain("ASSISTANT:\nEarlier answer")
    expect(prompt).toContain("USER:\nLatest")
  })
})
