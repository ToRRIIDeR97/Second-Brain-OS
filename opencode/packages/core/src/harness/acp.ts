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
  readonly approve: (request: PermissionRequest) => Effect.Effect<boolean>
}

export interface Session {
  readonly sessionId: string
  readonly resumed: boolean
  readonly models: ReadonlyArray<Harness.Model>
  readonly turn: (input: { readonly text: string; readonly model?: string }) => Stream.Stream<LLMEvent, LLMError>
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
      clientInfo: { name: "second_brain_os", title: "Second Brain OS", version: "0.1.0" },
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
      return { ...agentInfo(initialize), models: sessionModels(session.response).models }
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not start a session within 15 seconds.")),
    }),
  )

export function probe(
  process: Process,
  instance: { readonly id: Harness.InstanceID; readonly driver: Harness.DriverKind; readonly name: string },
  settings: Settings,
  directory: string,
): Effect.Effect<Harness.Instance> {
  const base = {
    id: instance.id,
    driver: instance.driver,
    name: instance.name,
    models: configuredModels(settings.models),
  }
  return handshake(process, settings, directory).pipe(
    Effect.map((agent) => Harness.Instance.make({ ...base, status: "available", version: agent.version })),
    Effect.catch((error) =>
      Effect.succeed(Harness.Instance.make({ ...base, status: "unavailable", error: errorMessage(error) })),
    ),
  )
}

export const open = Effect.fn("AcpHarness.open")(function* (process: Process, input: OpenInput) {
  const items = yield* Queue.unbounded<Item>()
  const { client, initialize } = yield* connect(process, input.settings, input.directory, {
    handleRequest: (request) => handleRequest(request, input.approve),
    onNotification: (notification) => Queue.offer(items, { type: "update", notification }).pipe(Effect.asVoid),
  }).pipe(
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () => Effect.fail(new ProtocolError("The ACP agent did not answer initialize within 30 seconds.")),
    }),
  )
  const capabilities = isRecord(initialize.agentCapabilities) ? initialize.agentCapabilities : {}
  const params = { cwd: input.directory, mcpServers: [] }
  const loaded =
    input.continuation && capabilities.loadSession === true
      ? yield* client.request("session/load", { ...params, sessionId: input.continuation }).pipe(
          Effect.map((response) => ({ sessionId: input.continuation!, response })),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      : undefined
  // A load replays history as updates before it responds; none of it belongs to the next turn.
  yield* Queue.clear(items)
  const session = loaded ?? (yield* createSession(client, params))
  const selector = sessionModels(session.response)
  const state = { currentModel: selector.current }

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
          Effect.tap(() =>
            Effect.sync(() => {
              state.currentModel = model
            }),
          ),
          Effect.ignore,
        )

  const turn = (turnInput: { readonly text: string; readonly model?: string }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* setModel(turnInput.model)
        yield* Queue.clear(items)
        const parser = acpState()
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
            Effect.suspend(() =>
              parser.finished
                ? Effect.void
                : client.notify("session/cancel", { sessionId: session.sessionId }).pipe(Effect.ignore),
            ),
          ),
        )
      }).pipe(Effect.mapError((error) => llmError(errorMessage(error)))),
    )

  return {
    sessionId: session.sessionId,
    resumed: loaded !== undefined,
    models: selector.models,
    turn,
  } satisfies Session
})

function createSession(client: Client, params: { readonly cwd: string; readonly mcpServers: ReadonlyArray<never> }) {
  return client.request("session/new", params).pipe(
    Effect.flatMap((response) => {
      const sessionId = isRecord(response) ? string(response.sessionId) : undefined
      return sessionId
        ? Effect.succeed({ sessionId, response })
        : Effect.fail(new ProtocolError("The ACP agent did not return a session ID."))
    }),
  )
}

export interface AcpState {
  readonly tools: Map<string, { readonly name: string; readonly input: unknown; done: boolean }>
  text?: { readonly id: string; readonly messageId?: string }
  reasoning?: { readonly id: string; readonly messageId?: string }
  blocks: number
  finished: boolean
}

export const acpState = (): AcpState => ({ tools: new Map(), blocks: 0, finished: false })

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
    const known = state.tools.get(id)
    const tool = known ?? {
      name: toolName(string(update.kind)),
      input: isRecord(update.rawInput) ? update.rawInput : { title: string(update.title) ?? "Tool" },
      done: false,
    }
    const start = known ? [] : [LLMEvent.toolCall({ id, name: tool.name, input: tool.input, providerExecuted: true })]
    state.tools.set(id, tool)
    const status = string(update.status)
    if (tool.done || (status !== "completed" && status !== "failed")) return [...closed, ...start]
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
      }),
    ]
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
  const reason = finishReason(string(response.stopReason))
  const usage = normalizeUsage(isRecord(response.usage) ? response.usage : undefined)
  return [...closed, LLMEvent.stepFinish({ index: 0, reason, usage }), LLMEvent.finish({ reason, usage })]
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

function toolName(kind: string | undefined) {
  return kind ? `acp_${kind}` : "acp_tool"
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

function normalizeUsage(value: Record<string, unknown> | undefined) {
  if (!value) return undefined
  const inputTokens = number(value.inputTokens)
  const cached = number(value.cachedReadTokens) ?? 0
  return {
    inputTokens,
    nonCachedInputTokens: inputTokens === undefined ? undefined : Math.max(0, inputTokens - cached),
    cacheReadInputTokens: cached,
    cacheWriteInputTokens: number(value.cachedWriteTokens),
    outputTokens: number(value.outputTokens),
    reasoningTokens: number(value.thoughtTokens),
    totalTokens: number(value.totalTokens),
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
} {
  const value = isRecord(response) ? response : {}
  if (isRecord(value.models)) {
    const current = string(value.models.currentModelId)
    const available = Array.isArray(value.models.availableModels) ? value.models.availableModels.filter(isRecord) : []
    return {
      current,
      models: available.flatMap((model) => modelEntry(string(model.modelId), model.name, model.description, current)),
    }
  }
  const option = (Array.isArray(value.configOptions) ? value.configOptions.filter(isRecord) : []).find(
    (item) => item.category === "model" && item.type === "select" && typeof item.id === "string",
  )
  if (!option) return { models: [] }
  const current = string(option.currentValue)
  const options = Array.isArray(option.options) ? option.options.filter(isRecord) : []
  return {
    current,
    configId: string(option.id),
    models: options.flatMap((item) => modelEntry(string(item.value), item.name, item.description, current)),
  }
}

function modelEntry(id: string | undefined, name: unknown, description: unknown, current: string | undefined) {
  if (!id) return []
  return [
    Harness.Model.make({
      id,
      name: string(name) ?? id,
      description: string(description),
      reasoningEfforts: [],
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
