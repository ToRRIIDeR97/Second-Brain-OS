import { describe, expect, test } from "bun:test"
import type { PartGroup } from "@opencode-ai/session-ui/message-part"
import { foldTimelineRows, reuseTimelineRows } from "./row-reconciliation"
import { TimelineRow } from "./timeline-row"

const context = (key: string, partIDs: string[], userMessageID = "user-1", type: "context" | "tools" = "context") =>
  new TimelineRow.AssistantPart({
    userMessageID,
    group: {
      key,
      type,
      refs: partIDs.map((partID) => ({ messageID: "assistant-1", partID })),
    } satisfies PartGroup,
    previousAssistantPart: false,
  })

const user = (userMessageID = "user-1") => new TimelineRow.UserMessage({ userMessageID, anchor: true })
const keys = (rows: TimelineRow.TimelineRow[]) => rows.map(TimelineRow.key)

describe("reuseTimelineRows", () => {
  test.each([
    {
      name: "reuses an unchanged context group",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [[0, 0]],
    },
    {
      name: "preserves the group key when a member is appended",
      previous: [context("context:a", ["a"])],
      rows: [context("context:a", ["a", "b"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "preserves the group key when the first member is removed",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "lets only the natural owner retain an old key after a split",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:a", ["a"]), context("context:b", ["b"])],
      expected: ["assistant-part:user-1:context:a", "assistant-part:user-1:context:b"],
      reused: [],
    },
    {
      name: "chooses the earliest prior key when groups merge",
      previous: [context("context:a", ["a"]), context("context:b", ["b"])],
      rows: [context("context:b", ["b", "a"])],
      expected: ["assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "reserves an old key for its natural owner when two new groups compete",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"])],
      expected: ["assistant-part:user-1:context:b", "assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "does not reuse context identity across user messages",
      previous: [context("context:a", ["a", "b"], "user-1")],
      rows: [context("context:b", ["b"], "user-2")],
      expected: ["assistant-part:user-2:context:b"],
      reused: [],
    },
    {
      name: "reuses an unaffected ordinary row",
      previous: [user()],
      rows: [user()],
      expected: ["user-message:user-1"],
      reused: [[0, 0]],
    },
    {
      name: "does not create accidental key collisions",
      previous: [context("context:a", ["a", "b", "c"])],
      rows: [context("context:b", ["b"]), context("context:a", ["a"]), context("context:c", ["c"])],
      expected: [
        "assistant-part:user-1:context:b",
        "assistant-part:user-1:context:a",
        "assistant-part:user-1:context:c",
      ],
      reused: [],
    },
    {
      name: "keeps the row key when a context group grows into a tools group",
      previous: [context("context:a", ["a", "b"])],
      rows: [context("tools:a", ["a", "b", "c"], "user-1", "tools")],
      expected: ["assistant-part:user-1:context:a"],
      reused: [],
    },
    {
      name: "keeps the row key when a tools group grows",
      previous: [context("tools:a", ["a", "b"], "user-1", "tools")],
      rows: [context("tools:a", ["a", "b", "c"], "user-1", "tools")],
      expected: ["assistant-part:user-1:tools:a"],
      reused: [],
    },
  ])("$name", ({ previous, rows, expected, reused }) => {
    const result = reuseTimelineRows([...previous], [...rows])

    expect(keys(result)).toEqual([...expected])
    expect(new Set(keys(result)).size).toBe(result.length)
    reused.forEach(([resultIndex, previousIndex]) => expect(result[resultIndex]).toBe(previous[previousIndex]))
  })
})

describe("foldTimelineRows", () => {
  const header = (segment: number) =>
    new TimelineRow.TurnSteps({ userMessageID: "user-1", segment, tools: [], failed: false })
  const step = (key: string) =>
    new TimelineRow.AssistantPart({
      userMessageID: "user-1",
      group: { key, type: "part", ref: { messageID: "assistant-1", partID: key } },
      previousAssistantPart: true,
      step: true,
    })
  const text = (key: string) =>
    new TimelineRow.AssistantPart({
      userMessageID: "user-1",
      group: { key, type: "part", ref: { messageID: "assistant-1", partID: key } },
      previousAssistantPart: true,
    })
  const rows = [
    user(),
    header(0),
    step("a"),
    text("b"),
    step("c"),
    new TimelineRow.TurnDivider({ userMessageID: "user-1", label: "interrupted" }),
    header(1),
    step("d"),
  ]

  test("keeps every row without a fold predicate", () => {
    expect(foldTimelineRows(rows, undefined)).toBe(rows)
  })

  test("hides only the folded segment's step rows and keeps its text", () => {
    expect(keys(foldTimelineRows(rows, (row) => row.segment === 0, "user-1"))).toEqual([
      "user-message:user-1",
      "turn-steps:user-1:0",
      "assistant-part:user-1:b",
      "turn-divider:user-1:interrupted",
      "turn-steps:user-1:1",
      "assistant-part:user-1:d",
    ])
  })

  test("passes whether the header belongs to the active turn", () => {
    const seen: boolean[] = []
    foldTimelineRows(rows, (_, active) => (seen.push(active), false), "user-1")
    expect(seen).toEqual([true, true])
  })
})
