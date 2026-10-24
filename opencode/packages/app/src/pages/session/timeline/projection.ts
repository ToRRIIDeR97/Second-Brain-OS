import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { AssistantMessage, Message, Part, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2"
import { createMemo, createSelector, mapArray, type Accessor } from "solid-js"
import { foldTimelineRows, reuseTimelineRows } from "./row-reconciliation"
import { Timeline, TimelineRow } from "./rows"
import { same } from "@/utils/same"

export { reuseTimelineRows } from "./row-reconciliation"

export function createTimelineProjection(input: {
  messages: Accessor<Message[]>
  userMessages: Accessor<UserMessage[]>
  sessionMessages: Accessor<SessionMessageInfo[]>
  parts: (messageID: string) => Part[]
  status: Accessor<SessionStatus>
  showReasoningSummaries: Accessor<boolean>
  inlineComments: Accessor<boolean>
  /** Whether a turn's steps are folded; folded step rows leave the virtual list. */
  folded?: (row: TimelineRow.TurnSteps, active: boolean) => boolean
}) {
  const messageByID = createMemo(() => new Map(input.messages().map((message) => [message.id, message] as const)))
  const assistantMessagesByParent = createMemo(() => {
    const result = new Map<string, AssistantMessage[]>()
    input.messages().forEach((message) => {
      if (message.role !== "assistant") return
      const messages = result.get(message.parentID)
      if (messages) {
        messages.push(message)
        return
      }
      result.set(message.parentID, [message])
    })
    return result
  })
  // Turns read messages only. Each turn builds its rows in its own memo, so a streamed part rebuilds
  // the active turn's rows instead of the whole session's.
  const turns = createMemo(() =>
    Timeline.constructSessionTurns(
      input.sessionMessages(),
      (messageID) => messageByID().get(messageID) as UserMessage | AssistantMessage | undefined,
      input.userMessages(),
    ),
  )
  const activeMessageID = createMemo(() => turns().at(-1)?.user.id)
  const isActive = createSelector(activeMessageID)
  const turnByID = createMemo(() => new Map(turns().map((turn, index) => [turn.user.id, { turn, index }] as const)))
  const turnRows = mapArray(
    () => turns().map((turn) => turn.user.id),
    (userMessageID) => {
      const entry = createMemo(() => turnByID().get(userMessageID), undefined, { equals: sameTurn })
      return createMemo((previous: TimelineRow.TimelineRow[] | undefined) => {
        const current = entry()
        if (!current) return []
        return reuseTimelineRows(
          previous,
          Timeline.constructTurnRows(
            current.turn,
            input.parts,
            current.index,
            input.showReasoningSummaries(),
            input.status().type,
            isActive(userMessageID) ? userMessageID : undefined,
            input.inlineComments(),
          ),
        )
      })
    },
  )
  const allRows = createMemo((previous: TimelineRow.TimelineRow[] | undefined) => {
    const next = turnRows().flatMap((rows) => rows())
    return previous && same(previous, next) ? previous : next
  })
  const rows = createMemo(() => foldTimelineRows(allRows(), input.folded, activeMessageID()), undefined, {
    equals: same,
  })
  const rowByKey = createMemo(() => new Map(rows().map((row) => [TimelineRow.key(row), row] as const)))
  const messageRowIndex = createMemo(() => {
    const result = new Map<string, number>()
    rows().forEach((row, index) => {
      if (!("userMessageID" in row) || result.has(row.userMessageID)) return
      result.set(row.userMessageID, index)
    })
    return result
  })
  const messageLastRowIndex = createMemo(() => {
    const result = new Map<string, number>()
    rows().forEach((row, index) => {
      if ("userMessageID" in row) result.set(row.userMessageID, index)
    })
    return result
  })
  const lastAssistantGroupKey = createMemo(() => {
    const result = new Map<string, string>()
    rows().forEach((row) => {
      if (row._tag === "AssistantPart") result.set(row.userMessageID, row.group.key)
    })
    return result
  })

  return {
    activeMessageID,
    assistantMessagesByParent,
    lastAssistantGroupKey,
    messageByID,
    messageRowIndex,
    messageLastRowIndex,
    rowByKey,
    rows,
  }
}

type TurnEntry = { turn: Timeline.Turn; index: number }

// Same messages in the same position class (first turn or not) build the same rows.
function sameTurn(a: TurnEntry | undefined, b: TurnEntry | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.turn.user === b.turn.user &&
    a.turn.shell === b.turn.shell &&
    a.index > 0 === b.index > 0 &&
    same(a.turn.assistants, b.turn.assistants)
  )
}
