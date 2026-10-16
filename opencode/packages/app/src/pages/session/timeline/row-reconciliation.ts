import { TimelineRow } from "./timeline-row"

type ContextRow = Extract<TimelineRow.TimelineRow, { _tag: "AssistantPart" }>
type PriorContext = { index: number; row: ContextRow }

export function reuseTimelineRows(previous: TimelineRow.TimelineRow[] | undefined, rows: TimelineRow.TimelineRow[]) {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [TimelineRow.key(row), row] as const))
  const contextByPart = new Map<string, PriorContext>()
  previous.forEach((row, index) => {
    if (row._tag !== "AssistantPart" || row.group.type === "part") return
    row.group.refs.forEach((ref) => contextByPart.set(`${row.userMessageID}:${ref.partID}`, { index, row }))
  })
  const reserved = new Map<string, number>()
  rows.forEach((row, index) => {
    if (row._tag !== "AssistantPart" || row.group.type === "part") return
    const key = TimelineRow.key(row)
    if (byKey.has(key) && !reserved.has(key)) reserved.set(key, index)
  })
  const claimed = new Set<string>()
  const next = rows.map((input, index) => {
    const row = stabilizeContextKey(contextByPart, reserved, input, index, claimed)
    const existing = byKey.get(TimelineRow.key(row))
    if (!existing) return row
    return TimelineRow.equals(existing, row) ? existing : row
  })
  if (previous.length === next.length && previous.every((row, index) => row === next[index])) return previous
  return next
}

function stabilizeContextKey(
  contextByPart: Map<string, PriorContext>,
  reserved: Map<string, number>,
  row: TimelineRow.TimelineRow,
  rowIndex: number,
  claimed: Set<string>,
) {
  if (row._tag !== "AssistantPart" || row.group.type === "part") return row
  const existing = row.group.refs.reduce<PriorContext | undefined>((result, ref) => {
    const candidate = contextByPart.get(`${row.userMessageID}:${ref.partID}`)
    if (!candidate) return result
    const key = TimelineRow.key(candidate.row)
    if (claimed.has(key)) return result
    const owner = reserved.get(key)
    if (owner !== undefined && owner !== rowIndex) return result
    return !result || candidate.index < result.index ? candidate : result
  }, undefined)
  if (!existing) return row
  const key = TimelineRow.key(existing.row)
  claimed.add(key)
  if (row.group.key === existing.row.group.key) return row
  return new TimelineRow.AssistantPart({
    ...row,
    group: { ...row.group, key: existing.row.group.key },
  })
}

/**
 * Drops a folded turn's step rows. A header governs the assistant rows after it until the next
 * non-assistant row (divider, thinking, diff summary, next turn); text rows in between stay.
 */
export function foldTimelineRows(
  rows: TimelineRow.TimelineRow[],
  folded: ((row: TimelineRow.TurnSteps, active: boolean) => boolean) | undefined,
  activeMessageID?: string,
) {
  if (!folded) return rows
  let hiding = false
  return rows.filter((row) => {
    if (row._tag === "TurnSteps") {
      hiding = folded(row, row.userMessageID === activeMessageID)
      return true
    }
    if (row._tag !== "AssistantPart") {
      hiding = false
      return true
    }
    return !(hiding && row.step)
  })
}
