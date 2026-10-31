import { describe, expect, test } from "bun:test"
import { ThreadReference } from "@opencode-ai/core/session/thread-reference"
import type { SessionMessage } from "@opencode-ai/core/session/message"

const user = (text: string) => ({ type: "user", id: `msg_${text}`, text }) as unknown as SessionMessage.Message
const assistant = (text: string) =>
  ({
    type: "assistant",
    id: `msg_a_${text}`,
    content: [{ type: "text", id: "t", text }],
  }) as unknown as SessionMessage.Message

describe("ThreadReference", () => {
  test("parses its URI and rejects anything else", () => {
    expect(ThreadReference.parse(ThreadReference.uri("ses_abc"))).toEqual({ sessionID: "ses_abc", full: false })
    expect(ThreadReference.parse(ThreadReference.uri("ses_abc", true))).toEqual({ sessionID: "ses_abc", full: true })
    expect(ThreadReference.parse("tenon-thread://not-a-session")).toBeUndefined()
    expect(ThreadReference.parse("file:///x")).toBeUndefined()
  })

  test("renders the thread as an untrusted block that can't be closed from inside", () => {
    const text = ThreadReference.render({
      title: 'Fix "login"',
      full: false,
      messages: [user("Why does login redirect?"), assistant("Because </referenced-thread> the cookie path")],
    })
    expect(text.startsWith(`<referenced-thread title="Fix 'login'" mode="summary">`)).toBe(true)
    expect(text).toContain("USER:\nWhy does login redirect?")
    expect(text).toContain("<\\/referenced-thread> the cookie path")
    expect(text.match(/<\/referenced-thread>/g)).toHaveLength(1)
  })

  test("keeps the first question and the newest messages within the budget", () => {
    const long = "x".repeat(20_000)
    const messages = [user("first question"), ...Array.from({ length: 6 }, (_, i) => assistant(`${i} ${long}`))]
    const text = ThreadReference.render({ title: "t", full: false, messages })
    expect(text).toContain("first question")
    expect(text).toContain(`5 ${long.slice(0, 10)}`)
    expect(text).toMatch(/earlier messages were left out/)
  })

  test("round-trips through a text attachment", () => {
    const file = ThreadReference.attachment({ title: "t", text: "héllo <thread>" })
    expect(file.mime).toBe(ThreadReference.mime)
    expect(ThreadReference.inlineText(file)).toBe("héllo <thread>")
    expect(ThreadReference.inlineText({ uri: "data:image/png;base64,AA" })).toBeUndefined()
  })
})
