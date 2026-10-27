import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { appendPromptText, extractPromptFromParts } from "./prompt"

describe("extractPromptFromParts", () => {
  test("restores multiple uploaded attachments", () => {
    const parts = [
      {
        id: "text_1",
        type: "text",
        text: "check these",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_1",
        type: "file",
        mime: "image/png",
        url: "data:image/png;base64,AAA",
        filename: "a.png",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
      {
        id: "file_2",
        type: "file",
        mime: "application/pdf",
        url: "data:application/pdf;base64,BBB",
        filename: "b.pdf",
        sessionID: "ses_1",
        messageID: "msg_1",
      },
    ] satisfies Part[]

    const result = extractPromptFromParts(parts)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ type: "text", content: "check these" })
    expect(result.slice(1)).toMatchObject([
      {
        type: "image",
        filename: "a.png",
        mime: "image/png",
        blob: expect.objectContaining({ id: expect.any(String) }),
      },
      {
        type: "image",
        filename: "b.pdf",
        mime: "application/pdf",
        blob: expect.objectContaining({ id: expect.any(String) }),
      },
    ])
  })
})

describe("appendPromptText", () => {
  const image = {
    type: "image" as const,
    id: "img_1",
    filename: "a.png",
    mime: "image/png",
    blob: { id: "blob_1", url: "blob:a" },
  }

  test("replaces an empty prompt and keeps images last", () => {
    expect(appendPromptText([{ type: "text", content: " ", start: 0, end: 1 }, image], 'Use design "A"')).toEqual([
      { type: "text", content: 'Use design "A"', start: 0, end: 14 },
      image,
    ])
  })

  test("extends trailing text with a separating space", () => {
    expect(appendPromptText([{ type: "text", content: "Make it blue.", start: 0, end: 13 }], "Use B")).toEqual([
      { type: "text", content: "Make it blue. Use B", start: 0, end: 19 },
    ])
    expect(appendPromptText([{ type: "text", content: "Hi\n", start: 0, end: 3 }], "Use B")).toEqual([
      { type: "text", content: "Hi\nUse B", start: 0, end: 8 },
    ])
  })

  test("adds a text part after a file mention", () => {
    const file = { type: "file" as const, path: "a.ts", content: "@a.ts", start: 0, end: 5 }
    expect(appendPromptText([file], "Use B")).toEqual([file, { type: "text", content: " Use B", start: 5, end: 11 }])
  })
})
