import { expect, test } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { LLM, Message, Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import type { EventV2 } from "@opencode-ai/core/event"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toStartWith(
    "Here is the conversation so far:\n\n<conversation>\nconversation history\n</conversation>",
  )
  expect(prompt.indexOf("</conversation>")).toBeLessThan(prompt.indexOf("Create a new anchored summary"))
  expect(prompt).toContain("conversation history in the <conversation> tags above")
  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction prompt gives update instructions for a prior summary", () => {
  const prompt = SessionCompaction.buildPrompt({
    context: ["new conversation"],
    previousSummary: "existing summary",
  })

  expect(prompt.indexOf("<conversation>")).toBeLessThan(prompt.indexOf("<prior-summary>"))
  expect(prompt.indexOf("</prior-summary>")).toBeLessThan(prompt.indexOf("The <prior-summary> summarizes"))
  expect(prompt).toContain(
    "Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary>",
  )
  expect(prompt).toContain('Move completed work from "Active" to "Completed".')
  expect(prompt).toContain('Update "Objective" and "Next Move" to reflect the current work state.')
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

test("a large image does not trigger compaction by itself", async () => {
  const model = Model.make({
    id: "vision",
    provider: "fake",
    route: OpenAIChat.route.with({ limits: { context: 100_000, output: 4_000 } }),
  })
  // About 10 MB of base64: millions of tokens if it were counted as text.
  const image = "A".repeat(10 * 1024 * 1024)
  const request = LLM.request({
    model,
    system: "You are helpful.",
    messages: [
      Message.user([
        { type: "text", text: "What is in this screenshot?" },
        { type: "media", mediaType: "image/png", data: image },
      ]),
      Message.tool({
        id: "call_1",
        name: "read",
        result: [{ type: "file", uri: `data:image/png;base64,${image}`, mime: "image/png" }],
        resultType: "content",
      }),
    ],
  })
  expect(SessionCompaction.estimateRequest(request)).toBeLessThan(10_000)

  const compaction = SessionCompaction.make({
    events: {} as EventV2.Interface,
    llm: { stream: () => Stream.die("compaction should not run") },
    config: [],
  })
  // Enough older history that compaction would summarize it if the estimate overflowed.
  const entries = ["older", "recent"].map((name, seq) => ({
    seq,
    message: SessionMessage.User.make({
      id: SessionMessage.ID.make(`msg_${name}`),
      type: "user",
      text: name.repeat(10_000),
      time: { created: DateTime.makeUnsafe(0) },
    }),
  }))
  const compacted = await Effect.runPromise(
    compaction.compactIfNeeded({ sessionID: SessionSchema.ID.create(), entries, model, request }),
  )
  expect(compacted).toBe(false)
})

test("non-image media is still estimated by its size", () => {
  const request = LLM.request({
    model: Model.make({ id: "pdf", provider: "fake", route: OpenAIChat.route }),
    messages: [Message.user([{ type: "media", mediaType: "application/pdf", data: "A".repeat(400_000) }])],
  })
  const estimate = SessionCompaction.estimateRequest(request)
  expect(estimate).toBeGreaterThanOrEqual(100_000)
  expect(estimate).toBeLessThan(100_010)
})
