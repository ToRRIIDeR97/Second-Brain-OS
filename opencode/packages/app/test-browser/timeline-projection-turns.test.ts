import { describe, expect, mock, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { Part } from "@opencode-ai/sdk/v2"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { normalizeSessionMessages } from "@/utils/session-message"

mock.module("@opencode-ai/session-ui/message-part", () => ({
  renderable: () => true,
}))

const { createTimelineProjection } = await import("@/pages/session/timeline/projection")

describe("createTimelineProjection", () => {
  test("a streamed part rebuilds only its own turn's rows", () => {
    const assistant = (id: string, created: number) => ({
      id,
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [{ type: "text", text: "answer" }],
      time: { created, completed: created + 1 },
    })
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      assistant("msg_2", 2),
      { id: "msg_3", type: "user", text: "second", time: { created: 4 } },
      assistant("msg_4", 5),
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const [store, setStore] = createStore({ parts: Object.fromEntries(normalized.parts) as Record<string, Part[]> })
    const reads = new Map<string, number>()

    createRoot((dispose) => {
      const projection = createTimelineProjection({
        messages: () => normalized.messages,
        userMessages: () => normalized.messages.filter((message) => message.role === "user"),
        sessionMessages: () => source,
        parts: (messageID) => {
          reads.set(messageID, (reads.get(messageID) ?? 0) + 1)
          return store.parts[messageID] ?? []
        },
        status: () => ({ type: "busy" }),
        showReasoningSummaries: () => true,
        inlineComments: () => true,
      })
      const before = projection.rows()
      const firstTurn = before.filter((row) => "userMessageID" in row && row.userMessageID === "msg_1")
      reads.clear()

      const streamed = { ...store.parts.msg_4![0]!, id: "msg_4:text:1" } as Part
      setStore("parts", "msg_4", (parts) => [...parts, streamed])

      const after = projection.rows()
      expect(after.length).toBe(before.length + 1)
      expect(reads.get("msg_1")).toBeUndefined()
      expect(reads.get("msg_2")).toBeUndefined()
      expect(reads.get("msg_4")).toBeGreaterThan(0)
      const firstAfter = after.filter((row) => "userMessageID" in row && row.userMessageID === "msg_1")
      expect(firstAfter.every((row, index) => row === firstTurn[index])).toBe(true)
      dispose()
    })
  })
})
