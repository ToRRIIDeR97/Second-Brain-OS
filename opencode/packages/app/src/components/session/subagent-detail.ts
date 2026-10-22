import type { ToolPart } from "@opencode-ai/sdk/v2"

export type SubagentTranscriptEntry =
  | { type: "text" | "reasoning"; text: string }
  | { type: "tool"; tool: string; title?: string; status: string; output?: string }

export interface SubagentDetail {
  agent?: string
  description?: string
  prompt?: string
  status: string
  transcript: SubagentTranscriptEntry[]
  truncated: boolean
  /** Absent when the harness reported no context use for the subagent. */
  context?: { used: number; size?: number; percent?: number }
  /** Each value is undefined when the harness didn't report it; never a stand-in 0. */
  usage: {
    input?: number
    output?: number
    reasoning?: number
    cacheRead?: number
    cacheWrite?: number
    cacheHit?: number
    cost?: number
  }
}

/** What the agent tab shows for one ACP subagent call, read from its tool part. */
export function subagentDetail(part: ToolPart): SubagentDetail {
  const input = part.state.input ?? {}
  const subagent = record(part.metadata?.acpSubagent) ? part.metadata.acpSubagent : {}
  const usage = record(subagent.usage) ? subagent.usage : undefined
  const used = number(usage?.used)
  const size = number(usage?.size)
  const inputTokens = number(usage?.inputTokens)
  const cacheRead = number(usage?.cachedReadTokens)
  const cacheWrite = number(usage?.cachedWriteTokens)
  const cacheTotal =
    inputTokens === undefined || cacheRead === undefined ? 0 : inputTokens + cacheRead + (cacheWrite ?? 0)
  return {
    agent: text(input.subagent_type),
    description: text(input.description),
    prompt: text(input.prompt),
    status: part.state.status,
    transcript: Array.isArray(subagent.transcript) ? subagent.transcript.flatMap(entry) : [],
    truncated: subagent.truncated === true,
    context:
      used === undefined
        ? undefined
        : {
            used,
            ...(size ? { size, percent: Math.round((used / size) * 100) } : {}),
          },
    usage: {
      input: inputTokens,
      output: number(usage?.outputTokens),
      reasoning: number(usage?.thoughtTokens),
      cacheRead,
      cacheWrite,
      cacheHit: cacheTotal > 0 && cacheRead !== undefined ? cacheRead / cacheTotal : undefined,
      cost: number(usage?.cost),
    },
  }
}

function entry(value: unknown): SubagentTranscriptEntry[] {
  if (!record(value)) return []
  if ((value.type === "text" || value.type === "reasoning") && typeof value.text === "string")
    return [{ type: value.type, text: value.text }]
  if (value.type !== "tool" || typeof value.tool !== "string" || typeof value.status !== "string") return []
  return [
    {
      type: "tool",
      tool: value.tool,
      status: value.status,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.output === "string" ? { output: value.output } : {}),
    },
  ]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
