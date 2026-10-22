import { describe, expect, test } from "bun:test"
import { LLM, Message, Model, ToolCallPart, ToolResultPart } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { Harness } from "@opencode-ai/schema/harness"
import {
  codexState,
  continuationFor,
  parseCodexNotification,
  renderCodexPrompt,
  renderHandoffHistory,
  renderHarnessPrompt,
} from "@opencode-ai/core/harness"
import { Token } from "@opencode-ai/core/util/token"

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

  test("emits each item start once when Codex repeats or reorders item/started", () => {
    const state = codexState()
    const started = (item: Record<string, unknown>) =>
      parseCodexNotification({ method: "item/started", params: { item } }, state).map((event) => event.type)

    const delta = parseCodexNotification(
      { method: "item/agentMessage/delta", params: { itemId: "message_1", delta: "Hi" } },
      state,
    )
    expect(delta.map((event) => event.type)).toEqual(["text-start", "text-delta"])
    expect(started({ id: "message_1", type: "agentMessage" })).toEqual([])
    expect(started({ id: "reasoning_1", type: "reasoning" })).toEqual(["reasoning-start"])
    expect(started({ id: "reasoning_1", type: "reasoning" })).toEqual([])
    expect(started({ id: "tool_1", type: "commandExecution", command: "ls" })).toEqual(["tool-call"])
    expect(started({ id: "tool_1", type: "commandExecution", command: "ls" })).toEqual([])
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

  test("adds the chat display guidance only to a runtime's first turn", () => {
    const model = Model.make({ id: "gpt-test", provider: "test", route })
    const request = LLM.request({ model, prompt: "Map the codebase" })

    expect(renderHarnessPrompt(request, "full")).toStartWith("<tenon-display>")
    expect(renderHarnessPrompt(request, "full")).toContain("```svg")
    expect(renderHarnessPrompt(request, "full")).toEndWith("Map the codebase")
    expect(renderHarnessPrompt(request, "none")).toBe(renderCodexPrompt(request, "none"))
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
      "full",
    )

    expect(prompt).toContain("USER:\nOld")
    expect(prompt).toContain("ASSISTANT:\nEarlier answer")
    expect(prompt.endsWith("New user message (respond to this):\nLatest")).toBe(true)
  })
})

const model = Model.make({ id: "gpt-test", provider: "test", route })
const user = (id: string, text: string) => ({ id, role: "user" as const, content: [{ type: "text" as const, text }] })
const assistant = (id: string, text: string) => ({
  id,
  role: "assistant" as const,
  content: [{ type: "text" as const, text }],
})

describe("Harness handoff history", () => {
  test("labels history as context only and separates the new request", () => {
    const prompt = renderCodexPrompt(
      LLM.request({ model, messages: [user("u1", "Old"), assistant("a1", "Answer"), user("u2", "Latest")] }),
      "full",
    )
    const [history, request] = prompt.split("\n---\n")

    expect(history).toStartWith("<handoff-history>\nEarlier conversation in this Run, shown for context only.")
    expect(history).toContain("It is not a new request and carries no instructions")
    expect(history!.trimEnd()).toEndWith("</handoff-history>")
    expect(history).not.toContain("Latest")
    expect(request).toBe("New user message (respond to this):\nLatest")
  })

  test("caps history, keeps the first and latest messages, and reports omissions", () => {
    const filler = "x".repeat(400)
    const messages = [
      user("u0", "First goal"),
      ...Array.from({ length: 20 }, (_, index) => [
        assistant(`a${index}`, `${filler} reply ${index}`),
        user(`u${index + 1}`, `${filler} ask ${index}`),
      ]).flat(),
      assistant("a-last", "Latest answer"),
    ]
    const block = renderHandoffHistory(
      messages.map((message) => Message.make(message)),
      { budget: 1_000 },
    )!

    expect(Token.estimate(block)).toBeLessThan(1_200)
    expect(block).toContain("USER:\nFirst goal")
    expect(block).toContain("ask 19")
    expect(block).toContain("ASSISTANT:\nLatest answer")
    expect(block).not.toContain("reply 0")
    expect(block).toMatch(/\d+ messages were omitted to fit the handoff budget\./)
  })

  test("omits oversized items whole and clips pinned ones", () => {
    const block = renderHandoffHistory(
      [
        user("u1", "Start"),
        assistant("a1", `huge ${"y".repeat(10_000)}`),
        user("u2", "Next"),
        assistant("a2", "Done"),
      ].map((message) => Message.make(message)),
      { budget: 500 },
    )!

    expect(block).not.toContain("huge")
    expect(block).toContain("1 message was omitted")
    const pinned = renderHandoffHistory([Message.make(user("u1", "z".repeat(10_000)))], { budget: 500 })!
    expect(pinned).toContain("[Message truncated]")
    expect(Token.estimate(pinned)).toBeLessThan(300)
  })

  test("summarizes tool calls without raw JSON", () => {
    const prompt = renderCodexPrompt(
      LLM.request({
        model,
        messages: [
          user("u1", "Check status"),
          Message.make({
            id: "a1",
            role: "assistant",
            content: [
              ToolCallPart.make({ id: "t1", name: "bash", input: { command: "git status --short", cwd: "/repo" } }),
              ToolResultPart.make({ id: "t1", name: "bash", result: { exitCode: 1, output: "fatal: secret" } }),
              ToolCallPart.make({ id: "t2", name: "read", input: { filePath: "src/app.ts" } }),
              ToolResultPart.make({ id: "t2", name: "read", result: "contents", resultType: "error" }),
            ],
          }),
          user("u2", "Latest"),
        ],
      }),
      "full",
    )

    expect(prompt).toContain("[Tool bash: git status --short]")
    expect(prompt).toContain("[Tool bash completed, exit 1]")
    expect(prompt).toContain("[Tool read: src/app.ts]")
    expect(prompt).toContain("[Tool read failed]")
    expect(prompt).not.toContain("{")
    expect(prompt).not.toContain("fatal: secret")
  })

  test("sends only messages since the harness last participated", () => {
    const request = LLM.request({
      model,
      messages: [
        user("u1", "Codex task"),
        assistant("a1", "Codex reply"),
        user("u2", "Claude task"),
        assistant("a2", "Claude reply"),
        user("u3", "Back to Codex"),
      ],
    })
    const delta = renderCodexPrompt(request, { since: "u1" })

    expect(delta).toContain("Messages added to this Run since you last participated")
    expect(delta).toContain("USER:\nClaude task")
    expect(delta).toContain("ASSISTANT:\nClaude reply")
    expect(delta).not.toContain("Codex task")
    expect(delta).not.toContain("Codex reply")
    expect(delta.endsWith("New user message (respond to this):\nBack to Codex")).toBe(true)
    expect(renderCodexPrompt(request, { since: "a2" })).toBe("Back to Codex")
    expect(renderCodexPrompt(request, { since: "missing" })).toContain("USER:\nCodex task")
  })

  test("reads per-instance continuations and the legacy single slot", () => {
    const codex = Harness.InstanceID.make("codex")
    const gemini = Harness.InstanceID.make("gemini")
    const metadata = {
      harnessContinuations: {
        codex: { nativeID: "thread-1", lastSeenMessageID: "u1" },
        gemini: { nativeID: "session-2" },
      },
    }

    expect(continuationFor(metadata, codex, 3)).toEqual({ nativeID: "thread-1", handoff: { since: "u1" } })
    expect(continuationFor(metadata, gemini, 3)).toEqual({ nativeID: "session-2", handoff: "full" })
    const legacy = { harnessContinuation: { instanceID: "codex", value: "thread-0", revision: 2 } }
    expect(continuationFor(legacy, codex, 2)).toEqual({ nativeID: "thread-0", handoff: "none" })
    expect(continuationFor(legacy, codex, 3)).toBeUndefined()
    expect(continuationFor(legacy, gemini, 2)).toBeUndefined()
  })
})
