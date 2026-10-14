import { describe, expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { readPartText } from "./message-part-text"
import { groupParts, toolGroupCounts } from "./part-group"

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

const tool = (id: string, name: string, status = "completed") =>
  ({ id, messageID: "msg", sessionID: "ses", type: "tool", callID: id, tool: name, state: { status } }) as Part
const text = (id: string) => ({ id, messageID: "msg", sessionID: "ses", type: "text", text: "hi" }) as Part
const group = (parts: Part[]) =>
  groupParts(parts.map((part) => ({ messageID: "msg", part }))).map((item) =>
    item.type === "part" ? item.key : `${item.key}[${item.refs.map((ref) => ref.partID).join(",")}]`,
  )

describe("groupParts", () => {
  test("collapses two or more completed tools into one tools group", () => {
    expect(group([tool("a", "read"), tool("b", "bash"), tool("c", "webfetch"), text("d")])).toEqual([
      "tools:a[a,b,c]",
      "part:msg:d",
    ])
  })

  test("leaves a single completed tool ungrouped", () => {
    expect(group([tool("a", "bash"), text("b")])).toEqual(["part:msg:a", "part:msg:b"])
  })

  test("keeps the running tool outside the group", () => {
    expect(group([tool("a", "bash"), tool("b", "bash"), tool("c", "bash", "running")])).toEqual([
      "tools:a[a,b]",
      "part:msg:c",
    ])
  })

  test("keeps file edits, questions and subagents outside the group", () => {
    expect(
      group([tool("a", "bash"), tool("b", "edit"), tool("c", "bash"), tool("d", "question"), tool("e", "task")]),
    ).toEqual(["part:msg:a", "part:msg:b", "part:msg:c", "part:msg:d", "part:msg:e"])
  })

  test("keeps errored tools outside the group", () => {
    expect(group([tool("a", "bash"), tool("b", "bash", "error"), tool("c", "bash"), tool("d", "bash")])).toEqual([
      "part:msg:a",
      "part:msg:b",
      "tools:c[c,d]",
    ])
  })

  test("keeps the existing context group for read-only runs", () => {
    expect(group([tool("a", "read"), tool("b", "grep"), tool("c", "read", "running")])).toEqual(["context:a[a,b,c]"])
    expect(group([tool("a", "read", "error"), tool("b", "read"), tool("c", "bash")])).toEqual([
      "context:a[a]",
      "tools:b[b,c]",
    ])
  })

  test("keeps the group key stable while the run grows during streaming", () => {
    const parts = [tool("a", "read"), tool("b", "bash"), tool("c", "bash", "running")]
    expect(group(parts)).toEqual(["tools:a[a,b]", "part:msg:c"])
    parts[2] = tool("c", "bash")
    parts.push(tool("d", "grep", "pending"))
    expect(group(parts)).toEqual(["tools:a[a,b,c]", "context:d[d]"])
  })

  test("counts tools by summary category", () => {
    const parts = [tool("a", "read"), tool("b", "bash"), tool("c", "glob"), tool("d", "webfetch"), tool("e", "read")]
    expect(toolGroupCounts(parts as ToolPart[])).toEqual({ read: 2, search: 1, command: 1, other: 1 })
  })
})
