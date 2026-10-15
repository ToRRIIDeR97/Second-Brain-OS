import type { Part, ToolPart } from "@opencode-ai/sdk/v2"

/** What a tool call did, independent of which harness named it. */
export type StepKind =
  | "read"
  | "search"
  | "edit"
  | "run"
  | "fetch"
  | "mcp"
  | "skill"
  | "subagent"
  | "todo"
  | "question"
  | "other"

export type Step = { kind: StepKind; target?: string }

export type TurnSteps = {
  counts: Partial<Record<StepKind, number>>
  failed: number
  running: number
  durationMs?: number
}

type Options = { mcpServers?: readonly string[] }

// Built-in, Codex app-server (`command_execution`, …) and ACP (`acp_<kind>`) names.
const KINDS: Record<string, StepKind> = {
  read: "read",
  acp_read: "read",
  glob: "search",
  grep: "search",
  list: "search",
  codesearch: "search",
  acp_search: "search",
  edit: "edit",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
  multiedit: "edit",
  file_change: "edit",
  acp_edit: "edit",
  acp_delete: "edit",
  acp_move: "edit",
  bash: "run",
  shell: "run",
  command_execution: "run",
  acp_execute: "run",
  webfetch: "fetch",
  websearch: "fetch",
  web_search: "fetch",
  acp_fetch: "fetch",
  mcp_tool_call: "mcp",
  skill: "skill",
  task: "subagent",
  todowrite: "todo",
  question: "question",
}

export function stepOf(part: ToolPart, options?: Options): Step {
  const input = part.state.input ?? {}
  const kind = KINDS[part.tool]
  if (kind) return withTarget(kind, targetOf(kind, input))
  const server = options?.mcpServers?.find((name) => part.tool.startsWith(`${name}_`))
  if (server) return { kind: "mcp", target: `${server} · ${part.tool.slice(server.length + 1)}` }
  return { kind: "other", target: part.tool }
}

export function summarizeTurn(
  parts: readonly Part[],
  options?: Options & { startedAt?: number; endedAt?: number },
): TurnSteps {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const counts = tools.reduce<Partial<Record<StepKind, number>>>((acc, part) => {
    const kind = stepOf(part, options).kind
    acc[kind] = (acc[kind] ?? 0) + 1
    return acc
  }, {})
  const failed = tools.filter((part) => part.state.status === "error").length
  const running = tools.filter((part) => part.state.status === "pending" || part.state.status === "running").length
  const durationMs =
    options?.startedAt !== undefined && options.endedAt !== undefined ? options.endedAt - options.startedAt : undefined
  return durationMs === undefined ? { counts, failed, running } : { counts, failed, running, durationMs }
}

function withTarget(kind: StepKind, target: string | undefined): Step {
  return target === undefined ? { kind } : { kind, target }
}

function targetOf(kind: StepKind, input: Record<string, unknown>) {
  if (kind === "read") return text(input.filePath, input.path, input.file_path, input.title)
  if (kind === "search") return text(input.pattern, input.query, input.path, input.title)
  if (kind === "edit") return text(input.filePath, input.path, firstChange(input.changes), input.title)
  if (kind === "run") return command(input.command) ?? text(input.title)
  if (kind === "fetch") return text(input.url, input.query, input.title)
  if (kind === "mcp") {
    const server = text(input.server)
    const tool = text(input.tool)
    return server && tool ? `${server} · ${tool}` : (tool ?? server)
  }
  if (kind === "skill") return text(input.name)
  if (kind === "subagent") return text(input.description)
  return undefined
}

function text(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0)
}

function command(value: unknown) {
  if (Array.isArray(value)) {
    const joined = value.filter((item): item is string => typeof item === "string").join(" ")
    return joined || undefined
  }
  return text(value)
}

/** Codex `fileChange` lists changes as an array of `{ path }` or an object keyed by path. */
function firstChange(changes: unknown) {
  if (Array.isArray(changes)) {
    const first = changes.find((item) => typeof item === "object" && item !== null && "path" in item)
    return text((first as { path?: unknown } | undefined)?.path)
  }
  if (typeof changes === "object" && changes !== null) return Object.keys(changes)[0]
  return undefined
}
