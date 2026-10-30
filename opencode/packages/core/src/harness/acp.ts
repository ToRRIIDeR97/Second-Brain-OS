export * as AcpHarness from "./acp"

import { LLMError, LLMEvent, TransportReason, type FinishReason } from "@opencode-ai/llm"
import { Harness } from "@opencode-ai/schema/harness"
import { Effect, Exit, Option, Queue, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import os from "os"
import path from "path"
import { ConfigHarness } from "../config/harness"
import type { AppProcess } from "../process"
import { harnessEnvironment } from "./env"
import {
  make as makeClient,
  ProtocolError,
  type Client,
  type Notification,
  type ServerRequest,
} from "./codex-app-server"

export const protocolVersion = 1

export interface Settings {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
  readonly models: ReadonlyArray<string>
}

export interface PermissionRequest {
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly title: string
  readonly kind?: string
}

export interface OpenInput {
  readonly settings: Settings
  readonly directory: string
  readonly continuation?: string
  /** HTTP MCP servers offered to the agent; dropped when it does not advertise `mcpCapabilities.http`. */
  readonly mcpServers?: ReadonlyArray<McpServer>
  readonly approve: (request: PermissionRequest) => Effect.Effect<boolean>
  /** Called with the slash commands the agent reports, whenever it reports them. */
  readonly onCommands?: (commands: ReadonlyArray<AcpCommand>) => Effect.Effect<void>
}

export interface AcpCommand {
  readonly name: string
  readonly description?: string
}

export interface Session {
  readonly sessionId: string
  readonly resumed: boolean
  /** The offered MCP servers were passed on: there were some and the agent advertises `mcpCapabilities.http`. */
  readonly mcpAttached: boolean
  readonly agent: { readonly name?: string; readonly version?: string }
  readonly models: ReadonlyArray<Harness.Model>
  /** True once the agent process has exited; the runtime must then be replaced. */
  readonly closed: Effect.Effect<boolean>
  readonly turn: (input: {
    readonly text: string
    readonly model?: string
    readonly reasoningEffort?: string
  }) => Stream.Stream<LLMEvent, LLMError>
}

/**
 * The mode to switch a new ACP session to, or undefined to leave it. Claude Code starts in the user's
 * `defaultMode`; in `bypassPermissions` every tool runs without asking Tenon, while Codex threads ask. The session
 * moves to the agent's `default` mode when it offers one.
 */
export function safeAcpMode(modes: unknown) {
  if (!isRecord(modes) || modes.currentModeId !== "bypassPermissions") return undefined
  const available = Array.isArray(modes.availableModes) ? modes.availableModes : []
  return available.some((mode) => isRecord(mode) && mode.id === "default") ? "default" : undefined
}

type Process = Pick<AppProcess.Interface, "spawn">

type Item =
  | { readonly type: "update"; readonly notification: Notification }
  | { readonly type: "done"; readonly exit: Exit.Exit<unknown, ProtocolError> }

const decodeAcp = Schema.decodeUnknownOption(ConfigHarness.Acp)

export function decodeSettings(config: Readonly<Record<string, unknown>>): Settings | undefined {
  const decoded = Option.getOrUndefined(decodeAcp(config))
  const command = decoded?.command.trim()
  if (!decoded || !command) return undefined
  return {
    command: expandHome(command),
    args: decoded.args ?? [],
    env: decoded.env ?? {},
    models: decoded.models ?? [],
  }
}

function connect(
  process: Process,
  settings: Settings,
  directory: string,
  options: {
    readonly handleRequest?: (request: ServerRequest) => Effect.Effect<unknown, ProtocolError>
    readonly onNotification?: (notification: Notification) => Effect.Effect<void>
  } = {},
) {
  return Effect.gen(function* () {
    const handle = yield* process
      .spawn(
        ChildProcess.make(settings.command, [...settings.args], {
          cwd: directory,
          env: harnessEnvironment(settings.env),
          extendEnv: false,
          forceKillAfter: "2 seconds",
          stdin: { stream: "pipe", endOnDone: false },
        }),
      )
      .pipe(Effect.mapError((cause) => new ProtocolError(`Could not start ${settings.command}.`, { cause })))
    yield* Stream.runDrain(handle.stderr).pipe(Effect.ignore, Effect.forkScoped)
    const client = yield* makeClient({
      connection: { stdout: handle.stdout, stdin: handle.stdin },
      jsonrpc: true,
      label: "ACP agent",
      handleRequest: options.handleRequest ?? ((request) => Effect.fail(unsupported(request.method))),
      onNotification: options.onNotification ?? (() => Effect.void),
    })
    const initialize = yield* client.request("initialize", {
      protocolVersion,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "second_brain_os", title: "Tenon Workbench", version: "0.1.0" },
    })
    const info = isRecord(initialize) ? initialize : {}
    if (info.protocolVersion !== protocolVersion)
      return yield* Effect.fail(
        new ProtocolError(`Unsupported ACP protocol version: ${json(info.protocolVersion ?? "missing")}.`),
      )
    return { client, initialize: info }
  })
}

export function agentInfo(initialize: Record<string, unknown>) {
  const agent = isRecord(initialize.agentInfo) ? initialize.agentInfo : undefined
  return { name: string(agent?.title) ?? string(agent?.name), version: string(agent?.version) }
}

export const handshake = (process: Process, settings: Settings, directory: string) =>
  Effect.scoped(connect(process, settings, directory)).pipe(
    Effect.timeoutOrElse({
      duration: "8 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not answer initialize within 8 seconds.")),
    }),
    Effect.map(({ initialize }) => agentInfo(initialize)),
  )

/** Handshake plus `session/new`, so Settings can show the agent's models before saving. */
export const discover = (process: Process, settings: Settings, directory: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { client, initialize } = yield* connect(process, settings, directory)
      const session = yield* createSession(client, { cwd: directory, mcpServers: [] })
      const selector = sessionModels(session.response)
      const configId = selector.configId
      const levels = (effort: EffortOption | undefined) =>
        (effort?.values ?? []).filter((value) => value !== EFFORT_DEFAULT)
      // Agents report levels for the active model only, so this throwaway session switches to each model once.
      // A switch can fail without saying anything about levels (Claude Code checks some models with its
      // server first), so a failed switch keeps the active model's levels rather than none.
      const models =
        selector.effort && configId
          ? yield* Effect.forEach(selector.models, (model) =>
              model.isDefault
                ? Effect.succeed(model)
                : client
                    .request("session/set_config_option", { sessionId: session.sessionId, configId, value: model.id })
                    .pipe(
                      Effect.map((response) => levels(sessionModels(response).effort)),
                      Effect.catch(() => Effect.succeed(levels(selector.effort))),
                      Effect.map((reasoningEfforts) => Harness.Model.make({ ...model, reasoningEfforts })),
                    ),
            )
          : selector.models
      return { ...agentInfo(initialize), models }
    }),
  ).pipe(
    // Claude Code needs about 10s here when warm (one switch per model), more on a busy cold start.
    Effect.timeoutOrElse({
      duration: "45 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not list its models within 45 seconds.")),
    }),
  )

export const verifyPrompt = "Reply with exactly: harness ok"

/**
 * Functional check used before saving a harness: open a real session, optionally switch model,
 * and run one short prompt. Tool permission requests are refused; the prompt needs no tools.
 */
export const verify = (process: Process, settings: Settings, directory: string, model?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const session = yield* open(process, { settings, directory, approve: () => Effect.succeed(false) })
      const events = yield* Stream.runCollect(session.turn({ text: verifyPrompt, model }))
      const reply = Array.from(events)
        .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
        .join("")
        .trim()
      return { ...session.agent, models: session.models, reply }
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "120 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not finish the test prompt within 120 seconds.")),
    }),
  )

/**
 * Availability check for the picker: the handshake alone, offering the known models. The agent's own
 * model list comes from `discover`, which the caller runs separately because it takes much longer.
 */
export function probe(
  process: Process,
  instance: { readonly id: Harness.InstanceID; readonly driver: Harness.DriverKind; readonly name: string },
  settings: Settings,
  directory: string,
  known?: ReadonlyArray<Harness.Model>,
): Effect.Effect<{ readonly instance: Harness.Instance; readonly discovered?: ReadonlyArray<Harness.Model> }> {
  const base = { id: instance.id, driver: instance.driver, name: instance.name }
  return handshake(process, settings, directory).pipe(
    Effect.map((agent) => ({
      instance: Harness.Instance.make({
        ...base,
        status: "available",
        version: agent.version,
        models: withConfigured(known ?? [], settings.models),
      }),
    })),
    Effect.catch((error) =>
      Effect.succeed({
        instance: Harness.Instance.make({
          ...base,
          status: "unavailable",
          error: errorMessage(error),
          models: withConfigured(known ?? [], settings.models),
        }),
      }),
    ),
  )
}

/**
 * The agent's own models when it reports any. Saved model IDs are only a fallback: entries added
 * before live discovery stored a snapshot, which would otherwise keep models the agent dropped.
 */
export function withConfigured(models: ReadonlyArray<Harness.Model>, configured: ReadonlyArray<string>) {
  return models.length > 0 ? [...models] : configuredModels(configured)
}

export const open = Effect.fn("AcpHarness.open")(function* (process: Process, input: OpenInput) {
  const items = yield* Queue.unbounded<Item>()
  const { client, initialize } = yield* connect(process, input.settings, input.directory, {
    handleRequest: (request) => handleRequest(request, input.approve),
    onNotification: (notification) => {
      // Agents often report commands right after session/new, before any turn reads the queue.
      const commands = input.onCommands ? reportedCommands(notification) : undefined
      return (commands ? input.onCommands!(commands) : Effect.void).pipe(
        Effect.andThen(Queue.offer(items, { type: "update", notification })),
        Effect.asVoid,
      )
    },
  }).pipe(
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not answer initialize within 30 seconds.")),
    }),
  )
  const capabilities = isRecord(initialize.agentCapabilities) ? initialize.agentCapabilities : {}
  const http = isRecord(capabilities.mcpCapabilities) && capabilities.mcpCapabilities.http === true
  const params = { cwd: input.directory, mcpServers: http ? (input.mcpServers ?? []) : [] }
  const loaded =
    input.continuation && capabilities.loadSession === true
      ? yield* client.request("session/load", { ...params, sessionId: input.continuation }, SESSION_SETUP_TIMEOUT).pipe(
          Effect.map((response) => ({ sessionId: input.continuation!, response })),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      : undefined
  // A load replays history as updates before it responds; none of it belongs to the next turn.
  yield* Queue.clear(items)
  const session = loaded ?? (yield* createSession(client, params))
  const mode = safeAcpMode(isRecord(session.response) ? session.response.modes : undefined)
  if (mode)
    yield* client
      .request("session/set_mode", { sessionId: session.sessionId, modeId: mode }, SESSION_SETUP_TIMEOUT)
      .pipe(
        Effect.tap(() => Effect.logInfo("ACP session moved out of bypass mode", { mode })),
        Effect.catch((error) => Effect.logWarning("ACP session could not leave bypass mode", { error: error.message })),
      )
  const selector = sessionModels(session.response)
  const state: { currentModel: string | undefined; effort?: EffortOption; sessionCost?: number } = {
    currentModel: selector.current,
    effort: selector.effort,
  }
  // set_config_option answers with every option, and a model switch can change or drop the levels.
  const readEffort = (response: unknown) =>
    Effect.sync(() => {
      if (isRecord(response) && Array.isArray(response.configOptions)) state.effort = sessionModels(response).effort
    })

  const setModel = (model: string | undefined) =>
    !model || model === state.currentModel
      ? Effect.void
      : (selector.configId
          ? client.request("session/set_config_option", {
              sessionId: session.sessionId,
              configId: selector.configId,
              value: model,
            })
          : client.request("session/set_model", { sessionId: session.sessionId, modelId: model })
        ).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              state.currentModel = model
            }).pipe(Effect.andThen(readEffort(response))),
          ),
          Effect.ignore,
        )

  // No effort chosen means the agent's own default, when it offers one.
  const setEffort = (effort: string | undefined) =>
    Effect.suspend(() => {
      const option = state.effort
      const value = effort ?? (option?.values.includes(EFFORT_DEFAULT) ? EFFORT_DEFAULT : undefined)
      if (!option || !value || value === option.current || !option.values.includes(value)) return Effect.void
      return client
        .request("session/set_config_option", { sessionId: session.sessionId, configId: option.configId, value })
        .pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              state.effort = { ...option, current: value }
            }).pipe(Effect.andThen(readEffort(response))),
          ),
          Effect.ignore,
        )
    })

  const turn = (turnInput: { readonly text: string; readonly model?: string; readonly reasoningEffort?: string }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // A folded level is sent as its `<base>/<level>` model; otherwise as the agent's level option.
        const variant = `${turnInput.model}/${turnInput.reasoningEffort}`
        yield* setModel(selector.variants?.has(variant) ? variant : turnInput.model)
        yield* setEffort(turnInput.reasoningEffort)
        yield* Queue.clear(items)
        const parser = acpState(state.sessionCost)
        yield* client
          .request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: turnInput.text }] })
          .pipe(
            Effect.exit,
            Effect.flatMap((exit) => Queue.offer(items, { type: "done", exit })),
            Effect.forkScoped,
          )
        const body = Stream.fromQueue(items).pipe(
          Stream.takeUntil((item) => item.type === "done"),
          Stream.flatMap((item) =>
            Stream.fromIterable(
              item.type === "done"
                ? finishAcpTurn(item.exit, parser)
                : parseAcpNotification(item.notification, session.sessionId, parser),
            ),
          ),
        )
        return Stream.concat(Stream.make(LLMEvent.stepStart({ index: 0 })), body).pipe(
          Stream.ensuring(
            Effect.suspend(() => {
              if (parser.sessionCost !== undefined) state.sessionCost = parser.sessionCost
              return parser.finished
                ? Effect.void
                : client.notify("session/cancel", { sessionId: session.sessionId }).pipe(Effect.ignore)
            }),
          ),
        )
      }).pipe(Effect.mapError((error) => llmError(errorMessage(error)))),
    )

  return {
    sessionId: session.sessionId,
    resumed: loaded !== undefined,
    mcpAttached: params.mcpServers.length > 0,
    closed: client.closed,
    agent: agentInfo(initialize),
    models: selector.models,
    turn,
  } satisfies Session
})

// session/load replays history before it answers, so allow more than the initialize handshake.
const SESSION_SETUP_TIMEOUT = "60 seconds"

export interface McpServer {
  readonly type: "http"
  readonly name: string
  readonly url: string
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>
}

function createSession(
  client: Client,
  params: { readonly cwd: string; readonly mcpServers: ReadonlyArray<McpServer> },
) {
  return client.request("session/new", params, SESSION_SETUP_TIMEOUT).pipe(
    Effect.flatMap((response) => {
      const sessionId = isRecord(response) ? string(response.sessionId) : undefined
      return sessionId
        ? Effect.succeed({ sessionId, response })
        : Effect.fail(new ProtocolError("The ACP agent did not return a session ID."))
    }),
  )
}

export interface AcpTool {
  readonly name: string
  input: Record<string, unknown>
  called: boolean
  done: boolean
  /** Steps a subagent ran in its own child session, keyed by the child's tool call ID. */
  readonly steps: Map<string, AcpStep>
  /** A subagent's conversation in arrival order; tool entries update in place. */
  readonly transcript: AcpTranscriptEntry[]
  /** The transcript entry of each child tool call, keyed by the child's tool call ID. */
  readonly entries: Map<string, AcpTranscriptTool>
  /** The text or reasoning entry later chunks of the same message merge into. */
  block?: { readonly type: "text" | "reasoning"; readonly messageId?: string; readonly entry: AcpTranscriptText }
  /** Characters of text, reasoning and tool output kept so far, for the transcript cap. */
  chars: number
  truncated?: boolean
  usage?: AcpUsage
}

export interface AcpStep {
  readonly tool: string
  title?: string
  status: string
}

export interface AcpTranscriptText {
  readonly type: "text" | "reasoning"
  text: string
}

export interface AcpTranscriptTool {
  readonly type: "tool"
  readonly tool: string
  title?: string
  status: string
  output?: string
}

export type AcpTranscriptEntry = AcpTranscriptText | AcpTranscriptTool

/** A subagent's context and token use as its child session reported it; absent keys were not reported. */
export interface AcpUsage {
  readonly used?: number
  readonly size?: number
  /** USD amount. */
  readonly cost?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly thoughtTokens?: number
  readonly cachedReadTokens?: number
  readonly cachedWriteTokens?: number
}

/** A subagent's transcript stops growing past this many characters of text, reasoning and tool output. */
export const TRANSCRIPT_LIMIT = 100_000
/** Live progress is stored for every checkpoint, so it carries only the latest entries and no tool output. */
export const PROGRESS_ENTRIES = 50

export interface AcpState {
  readonly tools: Map<string, AcpTool>
  /** Child session ID to the parent tool call that started it. */
  readonly children: Map<string, string>
  text?: { readonly id: string; readonly messageId?: string }
  reasoning?: { readonly id: string; readonly messageId?: string }
  blocks: number
  finished: boolean
  /** Cumulative session cost reported before this turn, so the turn records only its own share. */
  readonly previousCost?: number
  usage?: { readonly used?: number; readonly size?: number; readonly cost?: number }
  sessionCost?: number
  /** Slash commands the agent reported through `available_commands_update`. */
  commands?: AcpCommand[]
}

export const acpState = (previousCost?: number): AcpState => ({
  tools: new Map(),
  children: new Map(),
  blocks: 0,
  finished: false,
  previousCost,
})

export function parseAcpNotification(
  notification: Notification,
  sessionId: string,
  state: AcpState,
): ReadonlyArray<LLMEvent> {
  if (notification.method !== "session/update") return []
  const params = isRecord(notification.params) ? notification.params : {}
  if (params.sessionId !== sessionId || !isRecord(params.update)) return []
  const update = params.update
  const kind = string(update.sessionUpdate)
  // OpenCode forwards a subagent's updates under the parent session ID and marks them with
  // `_meta["opencode/child-session"]`. They belong to the subagent's row, not the parent turn.
  const child = childSession(update)
  if (child && child.id !== sessionId) return recordChild(state, child, kind, update)
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const content = isRecord(update.content) ? update.content : undefined
    const text = content?.type === "text" ? string(content.text) : undefined
    if (!text) return []
    return kind === "agent_message_chunk"
      ? [...openText(state, string(update.messageId)), LLMEvent.textDelta({ id: state.text!.id, text })]
      : [...openReasoning(state, string(update.messageId)), LLMEvent.reasoningDelta({ id: state.reasoning!.id, text })]
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const id = string(update.toolCallId)
    if (!id) return []
    const closed = closeBlocks(state)
    const tool = state.tools.get(id) ?? {
      name: toolName(update),
      input: {},
      called: false,
      done: false,
      steps: new Map(),
      transcript: [],
      entries: new Map(),
      chars: 0,
    }
    state.tools.set(id, tool)
    if (!tool.called) tool.input = toolInput(tool.name, update, tool.input)
    const status = string(update.status)
    const terminal = status === "completed" || status === "failed"
    // A pending call can carry partial arguments (OpenCode sends only `cwd`); the command or path
    // arrives with `in_progress`, so the call is published then, or when it finishes.
    const ready = !tool.called && (terminal || status === "in_progress")
    if (ready) tool.called = true
    const start = ready ? [LLMEvent.toolCall({ id, name: tool.name, input: tool.input, providerExecuted: true })] : []
    if (tool.done || !terminal) return [...closed, ...start]
    tool.done = true
    const value = toolOutput(update)
    return [
      ...closed,
      ...start,
      LLMEvent.toolResult({
        id,
        name: tool.name,
        providerExecuted: true,
        result: status === "failed" ? { type: "error", value } : { type: "text", value },
        ...(tool.name === "acp_subagent"
          ? { providerMetadata: { acp: subagentSnapshot(tool) } }
          : tool.steps.size === 0
            ? {}
            : { providerMetadata: { acp: { steps: [...tool.steps.values()] } } }),
      }),
    ]
  }
  if (kind === "usage_update") {
    const cost = isRecord(update.cost) && update.cost.currency === "USD" ? number(update.cost.amount) : undefined
    state.usage = { used: number(update.used), size: number(update.size), cost }
    return []
  }
  if (kind === "available_commands_update") {
    state.commands = commandList(update)
    return []
  }
  return []
}

export function finishAcpTurn(exit: Exit.Exit<unknown, ProtocolError>, state: AcpState): ReadonlyArray<LLMEvent> {
  state.finished = true
  const closed = closeBlocks(state)
  if (Exit.isFailure(exit)) {
    const error = Option.getOrUndefined(Exit.findErrorOption(exit))
    return [
      ...closed,
      LLMEvent.providerError({ message: error?.message ?? "The ACP agent failed." }),
      LLMEvent.stepFinish({ index: 0, reason: "error" }),
      LLMEvent.finish({ reason: "error" }),
    ]
  }
  const response = isRecord(exit.value) ? exit.value : {}
  const harness = harnessUsage(state)
  const usage = normalizeUsage(isRecord(response.usage) ? response.usage : undefined, harness)
  // OpenCode swallows provider failures (expired key, no credits, blocked free tier) and still
  // answers `end_turn`, so a turn with no output at all is reported instead of left blank.
  const empty =
    response.stopReason !== "cancelled" && state.blocks === 0 && state.tools.size === 0 && !usage?.outputTokens
  if (empty)
    return [
      ...closed,
      LLMEvent.providerError({
        message:
          "The agent ended the turn without a reply. Its provider may have rejected the request: check the selected model and the agent's credentials.",
      }),
      LLMEvent.stepFinish({ index: 0, reason: "error", usage }),
      LLMEvent.finish({ reason: "error", usage }),
    ]
  const reason = finishReason(string(response.stopReason))
  return [...closed, LLMEvent.stepFinish({ index: 0, reason, usage }), LLMEvent.finish({ reason, usage })]
}

/** ACP reports the session's cumulative cost; the turn's cost is the increase since the last turn. */
function harnessUsage(state: AcpState) {
  if (!state.usage) return undefined
  const amount = state.usage.cost
  if (amount !== undefined) state.sessionCost = amount
  return {
    contextUsed: state.usage.used,
    contextSize: state.usage.size,
    ...(amount === undefined ? {} : { cost: Math.max(0, amount - (state.previousCost ?? 0)), sessionCost: amount }),
  }
}

function openText(state: AcpState, messageId: string | undefined): ReadonlyArray<LLMEvent> {
  if (state.text && (messageId === undefined || messageId === state.text.messageId)) return []
  const closed = closeBlocks(state)
  state.text = { id: `acp-text-${++state.blocks}`, messageId }
  return [...closed, LLMEvent.textStart({ id: state.text.id })]
}

function openReasoning(state: AcpState, messageId: string | undefined): ReadonlyArray<LLMEvent> {
  if (state.reasoning && (messageId === undefined || messageId === state.reasoning.messageId)) return []
  const closed = closeBlocks(state)
  state.reasoning = { id: `acp-reasoning-${++state.blocks}`, messageId }
  return [...closed, LLMEvent.reasoningStart({ id: state.reasoning.id })]
}

function closeBlocks(state: AcpState): ReadonlyArray<LLMEvent> {
  const events = [
    ...(state.text ? [LLMEvent.textEnd({ id: state.text.id })] : []),
    ...(state.reasoning ? [LLMEvent.reasoningEnd({ id: state.reasoning.id })] : []),
  ]
  state.text = undefined
  state.reasoning = undefined
  return events
}

function handleRequest(request: ServerRequest, approve: OpenInput["approve"]) {
  if (request.method !== "session/request_permission") return Effect.fail(unsupported(request.method))
  const params = isRecord(request.params) ? request.params : {}
  const tool = isRecord(params.toolCall) ? params.toolCall : {}
  const options = Array.isArray(params.options) ? params.options.filter(isRecord) : []
  const kind = string(tool.kind)
  const title = string(tool.title) ?? "Tool"
  return approve({ action: permissionAction(kind), resources: permissionResources(tool, title), title, kind }).pipe(
    Effect.map((allowed) => {
      const option = allowed
        ? pickOption(options, "allow_once", "allow_always")
        : pickOption(options, "reject_once", "reject_always")
      return { outcome: option ? { outcome: "selected", optionId: option } : { outcome: "cancelled" } }
    }),
  )
}

function pickOption(options: ReadonlyArray<Record<string, unknown>>, preferred: string, fallback: string) {
  const option = options.find((item) => item.kind === preferred) ?? options.find((item) => item.kind === fallback)
  return string(option?.optionId)
}

export function permissionAction(kind: string | undefined) {
  if (kind === "execute") return "bash"
  if (kind === "edit" || kind === "delete" || kind === "move") return "edit"
  if (kind === "read" || kind === "search") return "read"
  if (kind === "fetch") return "webfetch"
  return "acp_tool"
}

function permissionResources(tool: Record<string, unknown>, title: string) {
  const input = isRecord(tool.rawInput) ? tool.rawInput : {}
  const command = Array.isArray(input.command)
    ? input.command.filter((part): part is string => typeof part === "string").join(" ")
    : string(input.command)
  const locations = Array.isArray(tool.locations)
    ? tool.locations.flatMap((location) => {
        const file = isRecord(location) ? string(location.path) : undefined
        return file ? [file] : []
      })
    : []
  const resources = [command, string(input.url), ...locations].filter((value): value is string => !!value)
  return resources.length > 0 ? resources : [title]
}

function toolName(update: Record<string, unknown>) {
  // OpenCode reports its subagent tool with the generic `think` kind; its own tool name is clearer.
  const name = string(update.name)
  if (name === "subagent" || name === "task") return "acp_subagent"
  const kind = string(update.kind)
  return kind ? `acp_${kind}` : "acp_tool"
}

/** The call's arguments plus the agent's title and first location, which rows fall back to. */
function toolInput(name: string, update: Record<string, unknown>, previous: Record<string, unknown>) {
  const raw = isRecord(update.rawInput) ? update.rawInput : {}
  const location = Array.isArray(update.locations) ? update.locations.find(isRecord) : undefined
  const path = string(location?.path)
  const title = string(update.title)
  const input = { ...previous, ...raw }
  if (Object.keys(raw).length === 0) return input
  return {
    ...input,
    ...(title && raw.title === undefined ? { title } : {}),
    ...(path && input.path === undefined ? { path } : {}),
    ...(name === "acp_subagent" && typeof raw.agent === "string" ? { subagent_type: raw.agent } : {}),
  }
}

function childSession(update: Record<string, unknown>) {
  const meta = isRecord(update._meta) ? update._meta["opencode/child-session"] : undefined
  if (!isRecord(meta)) return undefined
  const id = string(meta.id)
  return id ? { id, title: string(meta.title) } : undefined
}

/**
 * Route a child session's update to the subagent call that started it. Tool steps checkpoint the
 * subagent when one starts or changes status, and so does the end of a child message block, so the
 * row can show progress while it runs without an event per chunk.
 */
function recordChild(
  state: AcpState,
  child: { readonly id: string; readonly title?: string },
  kind: string | undefined,
  update: Record<string, unknown>,
): ReadonlyArray<LLMEvent> {
  const parentId = state.children.get(child.id) ?? subagentFor(state, child.title)
  const parent = parentId === undefined ? undefined : state.tools.get(parentId)
  if (parentId === undefined || !parent) return []
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    state.children.set(child.id, parentId)
    const content = isRecord(update.content) ? update.content : undefined
    const text = content?.type === "text" ? string(content.text) : undefined
    if (!text) return []
    const ended = appendChunk(
      parent,
      kind === "agent_message_chunk" ? "text" : "reasoning",
      string(update.messageId),
      text,
    )
    return ended ? progress(parentId, parent) : []
  }
  if (kind === "usage_update") {
    state.children.set(child.id, parentId)
    parent.usage = { ...parent.usage, ...childUsage(update) }
    return []
  }
  if (kind !== "tool_call" && kind !== "tool_call_update") return []
  const id = string(update.toolCallId)
  if (!id) return []
  state.children.set(child.id, parentId)
  const before = parent.steps.get(id)
  const previous = before ? `${before.status}:${before.title}` : undefined
  const step = parent.steps.get(id) ?? { tool: toolName(update), status: "pending" }
  // Titles arrive as "<subagent description>: <command or tool>"; the row already shows the description.
  const raw = isRecord(update.rawInput) ? update.rawInput : {}
  const title =
    string(raw.command) ?? string(raw.path) ?? string(update.title)?.replace(child.title ? `${child.title}: ` : "", "")
  if (title) step.title = title
  step.status = string(update.status) ?? step.status
  parent.steps.set(id, step)
  const entry = parent.entries.get(id) ?? { type: "tool" as const, tool: step.tool, status: step.status }
  if (!parent.entries.has(id)) {
    parent.entries.set(id, entry)
    parent.transcript.push(entry)
    parent.block = undefined
  }
  if (step.title) entry.title = step.title
  entry.status = step.status
  if ((step.status === "completed" || step.status === "failed") && entry.output === undefined) {
    const output = withinBudget(parent, toolOutput(update))
    if (output) entry.output = output
  }
  if (previous === `${step.status}:${step.title}`) return []
  return progress(parentId, parent)
}

/** Adds a child chunk to the transcript; true when it ended the previous text or reasoning block. */
function appendChunk(tool: AcpTool, type: "text" | "reasoning", messageId: string | undefined, text: string) {
  const block = tool.block
  const merges = block?.type === type && (messageId === undefined || messageId === block.messageId)
  if (tool.truncated) return false
  const kept = withinBudget(tool, text)
  if (merges) {
    block.entry.text += kept
    return false
  }
  if (kept) {
    const entry = { type, text: kept }
    tool.transcript.push(entry)
    tool.block = { type, messageId, entry }
  }
  return block !== undefined
}

/** The part of `text` that fits the subagent's transcript budget; marks the transcript truncated when cut. */
function withinBudget(tool: AcpTool, text: string) {
  if (tool.truncated) return ""
  const room = TRANSCRIPT_LIMIT - tool.chars
  if (text.length > room) tool.truncated = true
  const kept = text.length > room ? text.slice(0, room) : text
  tool.chars += kept.length
  return kept
}

/** The commands in an `available_commands_update`, or undefined for any other notification. */
export function reportedCommands(notification: Notification) {
  if (notification.method !== "session/update") return undefined
  const params = isRecord(notification.params) ? notification.params : {}
  const update = isRecord(params.update) ? params.update : {}
  return update.sessionUpdate === "available_commands_update" ? commandList(update) : undefined
}

function commandList(update: Record<string, unknown>): AcpCommand[] {
  const commands = Array.isArray(update.availableCommands) ? update.availableCommands.filter(isRecord) : []
  return commands.flatMap((command) => {
    const name = string(command.name)
    const description = string(command.description)
    return name ? [{ name, ...(description === undefined ? {} : { description }) }] : []
  })
}

function childUsage(update: Record<string, unknown>): AcpUsage {
  const cost = isRecord(update.cost) && update.cost.currency === "USD" ? number(update.cost.amount) : undefined
  const fields = {
    used: number(update.used),
    size: number(update.size),
    cost,
    inputTokens: number(update.inputTokens),
    outputTokens: number(update.outputTokens),
    thoughtTokens: number(update.thoughtTokens),
    cachedReadTokens: number(update.cachedReadTokens),
    cachedWriteTokens: number(update.cachedWriteTokens),
  }
  return Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== undefined))
}

function progress(id: string, tool: AcpTool): ReadonlyArray<LLMEvent> {
  if (!tool.called || tool.done) return []
  return [LLMEvent.toolProgress({ id, name: tool.name, structured: { acp: subagentSnapshot(tool, true) } })]
}

/**
 * A copy of the subagent's steps, transcript and usage, safe to publish while they keep changing.
 * A live checkpoint keeps the last entries without tool output; the result carries the full capped transcript.
 */
function subagentSnapshot(tool: AcpTool, live = false) {
  const transcript = live ? tool.transcript.slice(-PROGRESS_ENTRIES) : tool.transcript
  return {
    steps: [...tool.steps.values()].map((item) => ({ ...item })),
    transcript: transcript.map((item) => {
      if (!live || item.type !== "tool") return { ...item }
      const { output: _, ...rest } = item
      return rest
    }),
    ...(tool.usage ? { usage: { ...tool.usage } } : {}),
    ...(tool.truncated ? { truncated: true } : {}),
  }
}

function subagentFor(state: AcpState, title: string | undefined) {
  const open = [...state.tools.entries()].filter((entry) => entry[1].name === "acp_subagent" && !entry[1].done)
  return (open.find((entry) => entry[1].input.description === title) ?? open.at(-1))?.[0]
}

function toolOutput(update: Record<string, unknown>) {
  const content = Array.isArray(update.content) ? update.content.filter(isRecord) : []
  const parts = content.flatMap((item) => {
    if (item.type === "content" && isRecord(item.content) && item.content.type === "text") {
      const text = string(item.content.text)
      return text ? [text] : []
    }
    if (item.type === "diff") return [`Edited ${string(item.path) ?? "file"}`]
    if (item.type === "terminal") return [`Terminal ${string(item.terminalId) ?? ""}`.trim()]
    return []
  })
  const output =
    parts.length > 0 ? parts.join("\n") : update.rawOutput === undefined ? "Completed" : json(update.rawOutput)
  return output.length > 32_000 ? `${output.slice(0, 32_000)}\n[Output truncated]` : output
}

function finishReason(stopReason: string | undefined): FinishReason {
  if (stopReason === "max_tokens" || stopReason === "max_turn_requests") return "length"
  if (stopReason === "refusal") return "content-filter"
  if (stopReason === "end_turn" || stopReason === "cancelled") return "stop"
  return "unknown"
}

function normalizeUsage(value: Record<string, unknown> | undefined, harness?: Record<string, unknown>) {
  if (!value && !harness) return undefined
  const reported = number(value?.inputTokens)
  const read = number(value?.cachedReadTokens) ?? 0
  const write = number(value?.cachedWriteTokens)
  const output = number(value?.outputTokens)
  const total = number(value?.totalTokens)
  // OpenCode reports inputTokens without cache reads (total = input + cache + output + thought).
  // Agents that report it inclusively fail this check and keep the subtraction.
  const exclusive =
    reported !== undefined &&
    (reported < read || (total !== undefined && total >= reported + read + (write ?? 0) + (output ?? 0)))
  const nonCached = reported === undefined ? undefined : exclusive ? reported : Math.max(0, reported - read)
  return {
    inputTokens: nonCached === undefined ? undefined : nonCached + read + (write ?? 0),
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: read,
    cacheWriteInputTokens: write,
    outputTokens: output,
    reasoningTokens: number(value?.thoughtTokens),
    totalTokens: total,
    ...(harness ? { providerMetadata: { harness } } : {}),
  }
}

/**
 * Agents report models either in the legacy `models` field or, in newer ACP
 * versions, as a `configOptions` select of category `model`. The source decides
 * how a model switch is sent.
 */
export function sessionModels(response: unknown): {
  readonly models: ReadonlyArray<Harness.Model>
  readonly current?: string
  readonly configId?: string
  readonly effort?: EffortOption
  /** Ids of models that stand for a base model at one reasoning level, as `<base>/<level>`. */
  readonly variants?: ReadonlySet<string>
} {
  const value = isRecord(response) ? response : {}
  const configOptions = Array.isArray(value.configOptions) ? value.configOptions.filter(isRecord) : []
  const effort = effortOption(configOptions)
  // Agents report levels only for the active model, so only that model offers them.
  const entry = (id: string | undefined, name: unknown, description: unknown, current: string | undefined) =>
    modelEntry(id, name, description, current, id === current ? (effort?.values ?? []) : [])
  if (isRecord(value.models)) {
    const current = string(value.models.currentModelId)
    const available = Array.isArray(value.models.availableModels) ? value.models.availableModels.filter(isRecord) : []
    const models = available.flatMap((model) => entry(string(model.modelId), model.name, model.description, current))
    return { current, effort, ...(effort ? { models } : foldVariants(models, current)) }
  }
  const option = configOptions.find(
    (item) => item.category === "model" && item.type === "select" && typeof item.id === "string",
  )
  if (!option) return { models: [], effort }
  const current = string(option.currentValue)
  const options = Array.isArray(option.options) ? option.options.filter(isRecord) : []
  return {
    configId: string(option.id),
    effort,
    ...foldDefault(
      options.flatMap((item) => entry(string(item.value), item.name, item.description, current)),
      current,
    ),
  }
}

// Claude Code lists its account default as a `default` row described by the model it stands for
// ("Opus" for "Opus 5.5"). Show that model as the current one instead of a model named Default.
function foldDefault(models: ReadonlyArray<Harness.Model>, current: string | undefined) {
  const row = models.find((model) => model.id === MODEL_DEFAULT)
  const name = row?.description
  const target = name
    ? models.find((model) => model !== row && (model.name === name || model.name.startsWith(`${name} `)))
    : undefined
  if (!row || !target) return { models, current }
  const active = current === MODEL_DEFAULT
  return {
    current: active ? target.id : current,
    models: models
      .filter((model) => model !== row)
      .map((model) =>
        model === target && active
          ? Harness.Model.make({ ...model, reasoningEfforts: row.reasoningEfforts, isDefault: true })
          : model,
      ),
  }
}

/** The agent's reasoning-level select (ACP category `thought_level`), if it reports one. */
export type EffortOption = {
  readonly configId: string
  readonly current?: string
  readonly values: ReadonlyArray<string>
}

// The level OpenCode and other agents use for "no override"; the app shows its own Default entry instead.
const EFFORT_DEFAULT = "default"
const MODEL_DEFAULT = "default"

function effortOption(configOptions: ReadonlyArray<Record<string, unknown>>): EffortOption | undefined {
  const option = configOptions.find(
    (item) => item.category === "thought_level" && item.type === "select" && typeof item.id === "string",
  )
  if (!option) return
  const values = (Array.isArray(option.options) ? option.options.filter(isRecord) : []).flatMap((item) => {
    const value = string(item.value)
    return value ? [value] : []
  })
  return { configId: option.id as string, current: string(option.currentValue), values }
}

// OpenCode before `thought_level` lists each level as its own model, `<base>/<level>` named
// "<base name> (<level>)". Fold those into the base model's levels so the picker shows one model.
function foldVariants(models: ReadonlyArray<Harness.Model>, current: string | undefined) {
  const byId = new Map(models.map((model) => [model.id, model]))
  const levels = new Map<string, string[]>()
  const variants = new Set(
    models.flatMap((model) => {
      const slash = model.id.lastIndexOf("/")
      const base = slash > 0 ? byId.get(model.id.slice(0, slash)) : undefined
      const level = model.id.slice(slash + 1)
      if (!base || model.name !== `${base.name} (${level})`) return []
      levels.set(base.id, [...(levels.get(base.id) ?? []), level])
      return [model.id]
    }),
  )
  if (variants.size === 0) return { models }
  return {
    variants,
    models: models
      .filter((model) => !variants.has(model.id))
      .map((model) =>
        Harness.Model.make({
          ...model,
          reasoningEfforts: levels.get(model.id) ?? model.reasoningEfforts,
          isDefault:
            model.isDefault || (current !== undefined && variants.has(current) && current.startsWith(`${model.id}/`)),
        }),
      ),
  }
}

function modelEntry(
  id: string | undefined,
  name: unknown,
  description: unknown,
  current: string | undefined,
  efforts: ReadonlyArray<string>,
) {
  if (!id) return []
  return [
    Harness.Model.make({
      id,
      name: string(name) ?? id,
      description: string(description),
      reasoningEfforts: efforts.filter((effort) => effort !== EFFORT_DEFAULT),
      serviceTiers: [],
      isDefault: id === current,
    }),
  ]
}

export function configuredModels(models: ReadonlyArray<string>) {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)), (id) =>
    Harness.Model.make({ id, name: id, reasoningEfforts: [], serviceTiers: [], isDefault: false }),
  )
}

function unsupported(method: string) {
  return new ProtocolError(`Unsupported ACP client method: ${method}`, { code: -32601 })
}

function llmError(message: string) {
  return new LLMError({ module: "AcpHarness", method: "stream", reason: new TransportReason({ message }) })
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "The ACP agent is unavailable."
}

export function expandHome(input: string) {
  if (input === "~") return os.homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(os.homedir(), input.slice(2))
  return input
}

function json(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
