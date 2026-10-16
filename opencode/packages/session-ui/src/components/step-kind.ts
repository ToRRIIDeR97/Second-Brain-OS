import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import type { IconProps } from "@opencode-ai/ui/icon"

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

// Kinds share an icon and a verb whichever harness ran the step; kinds are never colour-coded.
const ICONS: Record<StepKind, IconProps["name"]> = {
  read: "glasses",
  search: "magnifying-glass-menu",
  edit: "code-lines",
  run: "console",
  fetch: "window-cursor",
  mcp: "mcp",
  skill: "brain",
  subagent: "task",
  todo: "checklist",
  question: "bubble-5",
  other: "mcp",
}

// Subagent rows show the agent name when the caller knows it; this is the fallback.
const VERBS: Record<StepKind, string> = {
  read: "secondBrain.step.read",
  search: "secondBrain.step.searched",
  edit: "secondBrain.step.edited",
  run: "secondBrain.step.ran",
  fetch: "secondBrain.step.fetched",
  mcp: "secondBrain.step.called",
  skill: "secondBrain.step.loadedSkill",
  subagent: "ui.tool.agent.default",
  todo: "ui.tool.todos",
  question: "ui.tool.questions",
  other: "secondBrain.step.called",
}

export function stepOf(part: ToolPart, options?: Options): Step {
  return toolStep(part.tool, part.state.input, options)
}

/** `stepOf` for callers that hold a tool name and input rather than a part. */
export function toolStep(tool: string, input: Record<string, unknown> | undefined, options?: Options): Step {
  const kind = KINDS[tool]
  if (kind) return withTarget(kind, targetOf(kind, input ?? {}))
  // MCP tools are named `sanitize(server) + "_" + tool` (opencode/src/mcp/catalog.ts), so match on the sanitized name.
  const server = options?.mcpServers?.find((name) => tool.startsWith(`${sanitize(name)}_`))
  if (server) return { kind: "mcp", target: `${server} · ${tool.slice(sanitize(server).length + 1)}` }
  return { kind: "other", target: tool }
}

/** i18n key for a step's verb, e.g. "Read", "Ran" or "Running". */
// Present-tense verbs for steps still in progress; kinds without one keep their regular verb.
const RUNNING_VERBS: Partial<Record<StepKind, string>> = {
  read: "secondBrain.step.reading",
  search: "secondBrain.step.searching",
  edit: "secondBrain.step.editing",
  run: "secondBrain.step.running",
  fetch: "secondBrain.step.fetching",
  mcp: "secondBrain.step.calling",
  skill: "secondBrain.step.loadingSkill",
  other: "secondBrain.step.calling",
}

export function stepVerbKey(kind: StepKind, running = false) {
  return (running && RUNNING_VERBS[kind]) || VERBS[kind]
}

export function stepIcon(kind: StepKind) {
  return ICONS[kind]
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

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
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
