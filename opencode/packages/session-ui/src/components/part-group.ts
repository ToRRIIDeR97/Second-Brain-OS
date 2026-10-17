import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"
import { stepOf } from "./step-kind"

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
// File changes, questions and subagents stay visible as their own rows.
const UNGROUPED_TOOLS = new Set(["edit", "write", "patch", "apply_patch", "multiedit", "question", "task", "todowrite"])

export type PartRef = {
  messageID: string
  partID: string
}

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context" | "tools"
      refs: PartRef[]
    }

export function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

/** A finished tool call that may be folded into a collapsed "tools" summary row. */
export function isCollapsibleTool(part: PartType): part is ToolPart {
  return part.type === "tool" && part.state.status === "completed" && !UNGROUPED_TOOLS.has(part.tool)
}

function sameRef(a: PartRef, b: PartRef) {
  return a.messageID === b.messageID && a.partID === b.partID
}

function sameGroup(a: PartGroup, b: PartGroup) {
  if (a === b) return true
  if (a.key !== b.key) return false
  if (a.type !== b.type) return false
  if (a.type === "part") {
    if (b.type !== "part") return false
    return sameRef(a.ref, b.ref)
  }
  if (b.type === "part") return false
  if (a.refs.length !== b.refs.length) return false
  return a.refs.every((ref, i) => sameRef(ref, b.refs[i]!))
}

export function sameGroups(a: readonly PartGroup[] | undefined, b: readonly PartGroup[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((item, i) => sameGroup(item, b[i]!))
}

/**
 * Groups renderable parts into timeline rows.
 * - Runs of 2+ completed, non-file-changing tools that include a non-context tool become a "tools" group.
 * - Remaining runs of read/glob/grep/list (any status) keep the existing "context" group.
 * - Everything else (text, edits, questions, errors, running tools) stays a single "part".
 * Group keys use the first part ID so a growing run keeps its row while streaming.
 */
export function groupParts(parts: { messageID: string; part: PartType }[]) {
  const tools = new Map<number, number>()
  for (let i = 0; i < parts.length; ) {
    if (!isCollapsibleTool(parts[i]!.part)) {
      i++
      continue
    }
    let end = i
    while (end < parts.length && isCollapsibleTool(parts[end]!.part)) end++
    if (end - i >= 2 && parts.slice(i, end).some((item) => !isContextGroupTool(item.part))) tools.set(i, end)
    i = end
  }

  const refs = (start: number, end: number) =>
    parts.slice(start, end).map((item) => ({ messageID: item.messageID, partID: item.part.id }))
  const result: PartGroup[] = []
  for (let i = 0; i < parts.length; ) {
    const first = parts[i]!
    const toolsEnd = tools.get(i)
    if (toolsEnd !== undefined) {
      result.push({ key: `tools:${first.part.id}`, type: "tools", refs: refs(i, toolsEnd) })
      i = toolsEnd
      continue
    }
    if (isContextGroupTool(first.part)) {
      let end = i + 1
      while (end < parts.length && isContextGroupTool(parts[end]!.part) && !tools.has(end)) end++
      result.push({ key: `context:${first.part.id}`, type: "context", refs: refs(i, end) })
      i = end
      continue
    }
    result.push({
      key: `part:${first.messageID}:${first.part.id}`,
      type: "part",
      ref: { messageID: first.messageID, partID: first.part.id },
    })
    i++
  }
  return result
}

export type ToolGroupCounts = { read: number; search: number; command: number; other: number }

export function toolGroupCounts(parts: readonly ToolPart[]): ToolGroupCounts {
  const counts = { read: 0, search: 0, command: 0, other: 0 }
  for (const part of parts) {
    const kind = stepOf(part).kind
    if (kind === "read") counts.read++
    else if (kind === "search") counts.search++
    else if (kind === "run") counts.command++
    else counts.other++
  }
  return counts
}
