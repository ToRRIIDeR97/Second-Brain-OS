import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import { createV2SessionReducer } from "./server-session-v2-reducer"
import { normalizeSessionMessages } from "@/utils/session-message"

const event = (input: object) => input as OpenCodeEvent
const base = { created: 1, location: { directory: "/repo" }, durable: { aggregateID: "ses_1", seq: 1, version: 1 } }

describe("v2 session reducer", () => {
  test("projects promoted input and streaming assistant content", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }

    apply({
      ...base,
      id: "evt_admitted",
      type: "session.input.admitted",
      data: {
        sessionID: "ses_1",
        inputID: "msg_user",
        input: { type: "user", delivery: "steer", data: { text: "hello" } },
      },
    })
    apply({
      ...base,
      id: "evt_promoted",
      type: "session.input.promoted",
      data: { sessionID: "ses_1", inputID: "msg_user" },
    })
    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_text_start",
      type: "session.text.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0 },
    })
    apply({
      ...base,
      id: "evt_text_delta",
      type: "session.text.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, delta: "hel" },
    })
    apply({
      ...base,
      id: "evt_text_end",
      type: "session.text.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, text: "hello" },
    })

    expect(messages[0]).toMatchObject({ id: "msg_user", type: "user", text: "hello" })
    expect(messages[1]).toMatchObject({
      id: "msg_assistant",
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    })
  })

  test("folds tool, retry, and completion events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }

    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_start",
      type: "session.tool.input.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_delta",
      type: "session.tool.input.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", delta: "{}" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        metadata: {},
        content: [{ type: "text", text: "done" }],
        executed: true,
      },
    })
    apply({
      ...base,
      id: "evt_retry",
      type: "session.retry.scheduled",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        at: 10,
        error: { type: "ProviderError", message: "retry" },
      },
    })
    apply({ ...base, id: "evt_done", type: "session.execution.succeeded", data: { sessionID: "ses_1" } })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      retry: undefined,
      content: [{ type: "tool", id: "call_1", state: { status: "completed", content: [{ text: "done" }] } }],
    })
  })

  test("requests hydration when promotion admission was missed", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.input.promoted",
        data: { sessionID: "ses_1", inputID: "msg_user" },
      }),
    )

    expect(result).toMatchObject({ sessionID: "ses_1", missing: "msg_user", touched: [] })
  })

  test("projects current prompt events once before the assistant response", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (type: "session.next.prompt.admitted" | "session.next.prompted") => {
      const result = reducer.reduce(
        messages,
        event({
          id: `evt_${type}`,
          type,
          data: {
            timestamp: "2026-09-01T00:43:00.000Z",
            sessionID: "ses_1",
            messageID: "msg_user",
            prompt: { text: "hello", files: [], agents: [] },
            delivery: "steer",
          },
        }),
      )
      if (result) messages = result.messages
    }

    apply("session.next.prompt.admitted")
    apply("session.next.prompted")

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: "msg_user",
      type: "user",
      text: "hello",
      time: { created: Date.parse("2026-09-01T00:43:00.000Z") },
    })
  })
})

test("queued prompts join the transcript only when promoted", () => {
  const reducer = createV2SessionReducer()
  const prompt = (type: "session.next.prompt.admitted" | "session.next.prompted", messages: SessionMessageInfo[]) =>
    reducer.reduce(
      messages,
      event({
        id: `evt_${type}`,
        type,
        data: {
          timestamp: 1,
          sessionID: "ses_1",
          messageID: "msg_queued",
          prompt: { text: "later", files: [], agents: [] },
          delivery: "queue",
        },
      }),
    )

  expect(prompt("session.next.prompt.admitted", [])).toBeUndefined()
  expect(prompt("session.next.prompted", [])?.messages).toMatchObject([{ id: "msg_queued", text: "later" }])
})

test("fork import events hydrate copied history once", () => {
  const reducer = createV2SessionReducer()
  const message = { id: "msg_fork", type: "user" as const, text: "copied context", time: { created: 1 } }
  const imported = event({
    ...base,
    id: "evt_imported",
    type: "session.next.message.imported",
    data: { sessionID: "ses_1", timestamp: 2, message },
  })
  const first = reducer.reduce([], imported)!
  expect(first).toMatchObject({ sessionID: "ses_1", messages: [message], touched: ["msg_fork"] })
  expect(reducer.reduce(first.messages, imported)!.messages).toEqual([message])
})

describe("v2 session reducer: session.next events", () => {
  test("streams steps as they arrive, before the step ends", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const send = (type: string, data: object) => {
      const result = reducer.reduce(
        messages,
        event({ ...base, id: `evt_${type}`, type, data: { sessionID: "ses_1", timestamp: 10, ...data } }),
      )
      if (result) messages = result.messages
      return result
    }
    const parts = () => normalizeSessionMessages("ses_1", messages).parts.get("msg_assistant") ?? []
    const tool = () => {
      const part = parts().find((item) => item.type === "tool")
      return part?.type === "tool" ? part : undefined
    }
    const assistantMessageID = "msg_assistant"

    send("session.next.prompted", { messageID: "msg_user", prompt: { text: "hi" } })
    expect(
      send("session.next.step.started", {
        assistantMessageID,
        agent: "build",
        model: { id: "gpt-5.6", providerID: "codex" },
      })?.touched,
    ).toEqual([assistantMessageID])

    send("session.next.text.started", { assistantMessageID, textID: "txt_1" })
    send("session.next.text.delta", { assistantMessageID, textID: "txt_1", delta: "Checking" })
    send("session.next.text.delta", { assistantMessageID, textID: "txt_1", delta: " the repo." })
    expect(parts().find((item) => item.type === "text")).toMatchObject({ text: "Checking the repo." })

    send("session.next.tool.input.started", { assistantMessageID, callID: "call_1", name: "command_execution" })
    expect(tool()?.state.status).toBe("pending")

    send("session.next.tool.input.ended", { assistantMessageID, callID: "call_1", text: '{"command":"ls"}' })
    send("session.next.tool.called", {
      assistantMessageID,
      callID: "call_1",
      tool: "command_execution",
      input: { command: "ls" },
      provider: { executed: true },
    })
    expect(tool()?.state).toMatchObject({ status: "running", input: { command: "ls" } })

    send("session.next.tool.success", {
      assistantMessageID,
      callID: "call_1",
      structured: {},
      content: [{ type: "text", text: "README.md" }],
      result: { type: "text", value: "README.md" },
      provider: { executed: true },
    })
    expect(tool()?.state).toMatchObject({ status: "completed", output: "README.md" })

    send("session.next.tool.input.started", { assistantMessageID, callID: "call_2", name: "command_execution" })
    send("session.next.tool.called", {
      assistantMessageID,
      callID: "call_2",
      tool: "command_execution",
      input: { command: "false" },
      provider: { executed: true },
    })
    send("session.next.tool.failed", {
      assistantMessageID,
      callID: "call_2",
      error: { type: "unknown", message: "exit 1" },
      provider: { executed: true },
    })
    const failed = parts().find((item) => item.type === "tool" && item.callID === "call_2")
    expect(failed?.type === "tool" ? failed.state : undefined).toMatchObject({ status: "error", error: "exit 1" })

    send("session.next.step.ended", { assistantMessageID, finish: "stop", cost: 0, tokens: {} })
    const assistant = messages.find((item) => item.id === assistantMessageID)
    expect(assistant?.type === "assistant" ? assistant.time.completed : undefined).toBe(10)
  })
})
