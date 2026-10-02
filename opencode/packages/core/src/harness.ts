export * as HarnessRuntime from "./harness"

import {
  InvalidProviderOutputReason,
  LLMClient,
  LLMError,
  LLMEvent,
  TransportReason,
  type ContentPart,
  type LLMRequest,
  type Message,
} from "@opencode-ai/llm"
import { Harness } from "@opencode-ai/schema/harness"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Context, DateTime, Effect, Exit, Layer, Option, Schema, Scope, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { eq } from "drizzle-orm"
import os from "os"
import path from "path"
import { Config } from "./config"
import { ConfigHarness } from "./config/harness"
import { Database } from "./database/database"
import { makeLocationNode } from "./effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { EventV2 } from "./event"
import { Global } from "./global"
import { AcpHarness } from "./harness/acp"
import {
  make as makeCodexClient,
  ProtocolError,
  type Client as CodexClient,
  type ServerRequest,
} from "./harness/codex-app-server"
import { HarnessRegistry } from "./harness/registry"
import { Location } from "./location"
import { PermissionV2 } from "./permission"
import { AppProcess } from "./process"
import { QuestionV2 } from "./question"
import { SessionTable } from "./session/sql"

export { Harness }

export interface Driver {
  readonly instanceID: Harness.InstanceID
  readonly kind: Harness.DriverKind
  readonly snapshot: Effect.Effect<Harness.Instance>
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, LLMError>
}

export interface StreamInput {
  readonly sessionID: SessionID
  readonly directory: string
  readonly request: LLMRequest
  readonly model?: Harness.ModelSelection
  readonly revision?: number
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Harness.Instance>>
  readonly driver: (instanceID: Harness.InstanceID) => Harness.DriverKind | undefined
  readonly stream: (
    input: StreamInput & { readonly instanceID: Harness.InstanceID },
  ) => Stream.Stream<LLMEvent, LLMError>
  readonly register: (
    input: unknown,
    request: Pick<PermissionV2.AssertInput, "sessionID" | "agent" | "source">,
  ) => Effect.Effect<HarnessRegistry.Registered, HarnessRegistry.RegisterError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HarnessRuntime") {}

export interface InstanceConfig {
  readonly id: Harness.InstanceID
  readonly driver: Harness.DriverKind
  readonly name: string
  readonly enabled: boolean
  readonly config: Readonly<Record<string, unknown>>
}

interface CodexRuntime {
  readonly client: CodexClient
  readonly scope: Scope.Closeable
  readonly threadID: string
  needsHandoff: boolean
}

interface AcpRuntime {
  readonly session: AcpHarness.Session
  readonly scope: Scope.Closeable
  needsHandoff: boolean
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLMClient.Service
    const process = yield* AppProcess.Service
    const config = yield* Config.Service
    const database = yield* Database.Service
    const location = yield* Location.Service
    const events = yield* EventV2.Service
    const permissions = yield* PermissionV2.Service
    const questions = yield* QuestionV2.Service
    const global = yield* Global.Service
    const entries = yield* config.entries()
    // Registry entries can be added while the location is open, so instances are re-read per call.
    let latest = configuredInstances(entries, yield* HarnessRegistry.read(global.config))
    const instances = HarnessRegistry.read(global.config).pipe(
      Effect.map((registry) => {
        latest = configuredInstances(entries, registry)
        return latest
      }),
    )
    const runtimes = new Map<string, CodexRuntime>()
    const acpRuntimes = new Map<string, AcpRuntime>()

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [...runtimes.values(), ...acpRuntimes.values()],
        (runtime) => Scope.close(runtime.scope, Exit.void),
        {
          discard: true,
        },
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            runtimes.clear()
            acpRuntimes.clear()
          }),
        ),
      ),
    )

    const register = (input: unknown, request: Pick<PermissionV2.AssertInput, "sessionID" | "agent" | "source">) =>
      instances.pipe(
        Effect.flatMap((current) =>
          HarnessRegistry.register(input, {
            configDir: global.config,
            directory: location.directory,
            existing: new Set(current.map((instance) => String(instance.id))),
            process,
            approve: (approval) =>
              approve(permissions, {
                ...request,
                action: "harness_register",
                resources: [approval.id],
                save: [],
                metadata: { id: approval.id, name: approval.name, command: approval.command, args: approval.args },
              }),
          }),
        ),
      )

    const makeRuntime = Effect.fn("HarnessRuntime.makeCodexRuntime")(function* (
      instance: InstanceConfig,
      input: StreamInput,
    ) {
      const settings = decodeCodexSettings(instance.config)
      const runtimeScope = yield* Scope.make()
      const close = Scope.close(runtimeScope, Exit.void).pipe(Effect.ignore)
      const runtime = yield* Effect.gen(function* () {
        const opened = yield* openCodex(process, settings, input.directory, (request) =>
          handleCodexRequest(request, input.sessionID, input.directory, permissions, questions, (args) =>
            register(args, { sessionID: input.sessionID }).pipe(Effect.map(HarnessRegistry.summary)),
          ),
        )
        const revision = input.revision ?? 0
        const continuation = yield* readContinuation(database.db, input.sessionID, instance.id, revision)
        const params = {
          model: input.model?.id,
          cwd: input.directory,
          runtimeWorkspaceRoots: [input.directory],
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
          developerInstructions: renderCodexInstructions(input.request),
          ephemeral: false,
        }
        const thread = continuation
          ? yield* opened.client
              .request("thread/resume", {
                threadId: continuation,
                ...params,
                excludeTurns: true,
              })
              .pipe(
                Effect.map((response) => ({ response, resumed: true })),
                Effect.catch((error) =>
                  recoverableResume(error)
                    ? opened.client
                        .request("thread/start", { ...params, dynamicTools: codexDynamicTools })
                        .pipe(Effect.map((response) => ({ response, resumed: false })))
                    : Effect.fail(error),
                ),
              )
          : {
              response: yield* opened.client.request("thread/start", { ...params, dynamicTools: codexDynamicTools }),
              resumed: false,
            }
        const threadID = responseThreadID(thread.response)
        if (!threadID) return yield* Effect.fail(new ProtocolError("Codex did not return a thread ID."))
        if (threadID !== continuation) {
          yield* events.publish(SessionEvent.HarnessContinuationSet, {
            sessionID: input.sessionID,
            timestamp: yield* DateTime.now,
            instanceID: instance.id,
            continuation: threadID,
            revision,
          })
        }
        return {
          client: opened.client,
          scope: runtimeScope,
          threadID,
          needsHandoff: !thread.resumed,
        } satisfies CodexRuntime
      }).pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.onError(() => close),
      )
      return runtime
    })

    const getRuntime = Effect.fn("HarnessRuntime.getCodexRuntime")(function* (
      instance: InstanceConfig,
      input: StreamInput,
    ) {
      const key = `${instance.id}:${input.sessionID}:${input.revision ?? 0}`
      const current = runtimes.get(key)
      if (current) return current
      const prefix = `${instance.id}:${input.sessionID}:`
      for (const [candidate, runtime] of runtimes) {
        if (!candidate.startsWith(prefix)) continue
        runtimes.delete(candidate)
        yield* Scope.close(runtime.scope, Exit.void).pipe(Effect.ignore)
      }
      const runtime = yield* makeRuntime(instance, input)
      runtimes.set(key, runtime)
      return runtime
    })

    const discardRuntime = (instance: InstanceConfig, input: StreamInput, runtime: CodexRuntime) =>
      Effect.sync(() => {
        const key = `${instance.id}:${input.sessionID}:${input.revision ?? 0}`
        if (runtimes.get(key) === runtime) runtimes.delete(key)
      }).pipe(Effect.andThen(Scope.close(runtime.scope, Exit.void)), Effect.ignore)

    const makeAcpRuntime = Effect.fn("HarnessRuntime.makeAcpRuntime")(function* (
      instance: InstanceConfig,
      settings: AcpHarness.Settings,
      input: StreamInput,
    ) {
      const runtimeScope = yield* Scope.make()
      const revision = input.revision ?? 0
      const continuation = yield* readContinuation(database.db, input.sessionID, instance.id, revision)
      const session = yield* AcpHarness.open(process, {
        settings,
        directory: input.directory,
        continuation,
        approve: (request) =>
          approve(permissions, {
            sessionID: input.sessionID,
            action: request.action,
            resources: [...request.resources],
            save: [...request.resources],
            metadata: { harness: instance.id, title: request.title, ...(request.kind ? { kind: request.kind } : {}) },
          }),
      }).pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.onError(() => Scope.close(runtimeScope, Exit.void).pipe(Effect.ignore)),
      )
      if (session.sessionId !== continuation) {
        yield* events.publish(SessionEvent.HarnessContinuationSet, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          instanceID: instance.id,
          continuation: session.sessionId,
          revision,
        })
      }
      const history = input.request.messages.filter((message) => message.role !== "system").length > 1
      return { session, scope: runtimeScope, needsHandoff: !session.resumed && history } satisfies AcpRuntime
    })

    const getAcpRuntime = Effect.fn("HarnessRuntime.getAcpRuntime")(function* (
      instance: InstanceConfig,
      settings: AcpHarness.Settings,
      input: StreamInput,
    ) {
      const key = `${instance.id}:${input.sessionID}:${input.revision ?? 0}`
      const current = acpRuntimes.get(key)
      if (current) return current
      const prefix = `${instance.id}:${input.sessionID}:`
      for (const [candidate, runtime] of acpRuntimes) {
        if (!candidate.startsWith(prefix)) continue
        acpRuntimes.delete(candidate)
        yield* Scope.close(runtime.scope, Exit.void).pipe(Effect.ignore)
      }
      const runtime = yield* makeAcpRuntime(instance, settings, input)
      acpRuntimes.set(key, runtime)
      return runtime
    })

    const discardAcpRuntime = (instance: InstanceConfig, input: StreamInput, runtime: AcpRuntime) =>
      Effect.sync(() => {
        const key = `${instance.id}:${input.sessionID}:${input.revision ?? 0}`
        if (acpRuntimes.get(key) === runtime) acpRuntimes.delete(key)
      }).pipe(Effect.andThen(Scope.close(runtime.scope, Exit.void)), Effect.ignore)

    const acpStream = (instance: InstanceConfig, settings: AcpHarness.Settings, input: StreamInput) =>
      Stream.unwrap(
        getAcpRuntime(instance, settings, input).pipe(
          Effect.map((runtime) => {
            const text = renderCodexPrompt(input.request, runtime.needsHandoff)
            runtime.needsHandoff = false
            return runtime.session
              .turn({ text, model: input.model?.id })
              .pipe(
                Stream.catch((error) =>
                  Stream.unwrap(discardAcpRuntime(instance, input, runtime).pipe(Effect.as(Stream.fail(error)))),
                ),
              )
          }),
          Effect.mapError((error) => llmError("AcpHarness", "stream", errorMessage(error))),
        ),
      )

    const unavailable = (instance: InstanceConfig, error: string, models: ReadonlyArray<Harness.Model> = []) =>
      Effect.succeed(
        Harness.Instance.make({
          id: instance.id,
          driver: instance.driver,
          name: instance.name,
          status: "unavailable",
          error,
          models,
        }),
      )

    const driverFor = (instance: InstanceConfig): Driver => {
      if (instance.driver === Harness.OpenCodeDriver) {
        return {
          instanceID: instance.id,
          kind: instance.driver,
          snapshot: instance.enabled
            ? Effect.succeed(
                Harness.Instance.make({
                  id: instance.id,
                  driver: instance.driver,
                  name: instance.name,
                  status: "available",
                  models: [],
                }),
              )
            : unavailable(instance, "Disabled in configuration."),
          stream: (input) =>
            instance.enabled
              ? withProviderIdleTimeout(llm.stream(input.request))
              : Stream.fail(llmError("HarnessRuntime", "stream", `${instance.name} is disabled.`)),
        }
      }
      if (instance.driver === Harness.CodexDriver) {
        const settings = decodeCodexSettings(instance.config)
        return {
          instanceID: instance.id,
          kind: instance.driver,
          snapshot: instance.enabled
            ? probeCodex(process, instance, settings, location.directory)
            : unavailable(instance, "Disabled in configuration.", customModels(settings.customModels)),
          stream: (input) =>
            instance.enabled
              ? codexStream(getRuntime(instance, input), input, (runtime) => discardRuntime(instance, input, runtime))
              : Stream.fail(llmError("CodexHarness", "stream", `${instance.name} is disabled.`)),
        }
      }
      if (instance.driver === Harness.AcpDriver) {
        const settings = AcpHarness.decodeSettings(instance.config)
        if (!settings)
          return {
            instanceID: instance.id,
            kind: instance.driver,
            snapshot: unavailable(instance, "ACP harness configuration needs a command."),
            stream: () => Stream.fail(llmError("AcpHarness", "stream", `${instance.name} has no command.`)),
          }
        return {
          instanceID: instance.id,
          kind: instance.driver,
          snapshot: instance.enabled
            ? AcpHarness.probe(process, instance, settings, location.directory)
            : unavailable(instance, "Disabled in configuration.", AcpHarness.configuredModels(settings.models)),
          stream: (input) =>
            instance.enabled
              ? acpStream(instance, settings, input)
              : Stream.fail(llmError("AcpHarness", "stream", `${instance.name} is disabled.`)),
        }
      }
      return {
        instanceID: instance.id,
        kind: instance.driver,
        snapshot: unavailable(instance, `Driver '${instance.driver}' is not installed.`),
        stream: () => Stream.fail(llmError("HarnessRuntime", "stream", `Unknown harness driver: ${instance.driver}`)),
      }
    }

    return Service.of({
      list: () =>
        instances.pipe(
          Effect.flatMap((current) =>
            Effect.forEach(current, (instance) => driverFor(instance).snapshot, { concurrency: "unbounded" }),
          ),
        ),
      driver: (instanceID) => latest.find((instance) => instance.id === instanceID)?.driver,
      stream(input) {
        // Known instances stream without touching the registry; only a newly registered ID needs a re-read.
        const known = latest.find((item) => item.id === input.instanceID)
        if (known) return driverFor(known).stream(input)
        return Stream.unwrap(
          instances.pipe(
            Effect.map((current) => {
              const instance = current.find((item) => item.id === input.instanceID)
              return instance
                ? driverFor(instance).stream(input)
                : Stream.fail(llmError("HarnessRuntime", "stream", `Unknown harness instance: ${input.instanceID}`))
            }),
          ),
        )
      },
      register,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    llmClient,
    AppProcess.node,
    Config.node,
    Database.node,
    Location.node,
    EventV2.node,
    PermissionV2.node,
    QuestionV2.node,
    Global.node,
  ],
})

export function configuredInstances(
  entries: ReadonlyArray<Config.Entry>,
  registry: Readonly<Record<string, ConfigHarness.Instance>> = {},
) {
  const instances = new Map<Harness.InstanceID, InstanceConfig>([
    [
      Harness.OpenCode,
      { id: Harness.OpenCode, driver: Harness.OpenCodeDriver, name: "OpenCode", enabled: true, config: {} },
    ],
    [Harness.Codex, { id: Harness.Codex, driver: Harness.CodexDriver, name: "Codex", enabled: true, config: {} }],
  ])
  const decodeID = Schema.decodeUnknownOption(Harness.InstanceID)
  for (const [rawID, value] of Object.entries(registry)) {
    const id = Option.getOrUndefined(decodeID(rawID))
    if (!id || HarnessRegistry.reserved.has(id)) continue
    instances.set(id, {
      id,
      driver: value.driver,
      name: value.name?.trim() || rawID,
      enabled: value.enabled !== false,
      config: value.config ?? {},
    })
  }
  for (const entry of entries) {
    if (entry.type !== "document" || !entry.info.harnesses) continue
    for (const [rawID, value] of Object.entries(entry.info.harnesses)) {
      const id = Option.getOrUndefined(decodeID(rawID))
      if (!id) continue
      instances.set(id, {
        id,
        driver: value.driver,
        name: value.name?.trim() || rawID,
        enabled: value.enabled !== false,
        config: value.config ?? {},
      })
    }
  }
  return Array.from(instances.values())
}

const decodeCodex = Schema.decodeUnknownOption(ConfigHarness.Codex)

function decodeCodexSettings(input: Readonly<Record<string, unknown>>) {
  return (
    Option.getOrUndefined(decodeCodex(input)) ??
    new ConfigHarness.Codex({ binaryPath: "codex", launchArgs: [], customModels: [] })
  )
}

type CodexSettings = ConfigHarness.Codex

function openCodex(
  process: Pick<AppProcess.Interface, "spawn">,
  settings: CodexSettings,
  directory: string,
  handleRequest?: (request: ServerRequest) => Effect.Effect<unknown, ProtocolError>,
) {
  return Effect.gen(function* () {
    const handle = yield* process.spawn(
      ChildProcess.make(settings.binaryPath?.trim() || "codex", ["app-server", ...(settings.launchArgs ?? [])], {
        cwd: directory,
        env: settings.homePath ? { CODEX_HOME: expandHome(settings.homePath) } : undefined,
        extendEnv: true,
        forceKillAfter: "2 seconds",
        stdin: { stream: "pipe", endOnDone: false },
      }),
    )
    yield* Stream.runDrain(handle.stderr).pipe(Effect.ignore, Effect.forkScoped)
    const client = yield* makeCodexClient({
      connection: { stdout: handle.stdout, stdin: handle.stdin },
      handleRequest,
    })
    const initialize = yield* client.request("initialize", {
      clientInfo: { name: "second_brain_os", title: "Second Brain OS", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
    yield* client.notify("initialized")
    return { client, initialize }
  })
}

function probeCodex(
  process: Pick<AppProcess.Interface, "spawn">,
  instance: InstanceConfig,
  settings: CodexSettings,
  directory: string,
): Effect.Effect<Harness.Instance> {
  const probe = Effect.scoped(
    Effect.gen(function* () {
      const opened = yield* openCodex(process, settings, directory)
      const account = yield* opened.client.request("account/read", {})
      const auth = readAccount(account)
      const models = auth.available
        ? appendCustomModels(yield* requestModels(opened.client), settings.customModels)
        : customModels(settings.customModels)
      return Harness.Instance.make({
        id: instance.id,
        driver: instance.driver,
        name: instance.name,
        status: auth.available ? "available" : "unavailable",
        version: readVersion(opened.initialize),
        authenticated: auth.authenticated,
        error: auth.available ? undefined : "Codex sign-in is required.",
        models,
      })
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "8 seconds",
      orElse: () => Effect.fail(new ProtocolError("Codex availability check timed out.")),
    }),
  )
  return probe.pipe(
    Effect.catch((error) =>
      Effect.succeed(
        Harness.Instance.make({
          id: instance.id,
          driver: instance.driver,
          name: instance.name,
          status: "unavailable",
          error: error instanceof Error ? error.message : "Codex is unavailable.",
          models: customModels(settings.customModels),
        }),
      ),
    ),
    Effect.orDie,
  )
}

function requestModels(
  client: CodexClient,
  cursor?: string,
): Effect.Effect<ReadonlyArray<Harness.Model>, ProtocolError> {
  return client.request("model/list", { cursor, includeHidden: false }).pipe(
    Effect.flatMap((response) => {
      const record = isRecord(response) ? response : undefined
      const models = Array.isArray(record?.data) ? record.data.flatMap(parseModel) : []
      const next = typeof record?.nextCursor === "string" ? record.nextCursor : undefined
      return next
        ? requestModels(client, next).pipe(Effect.map((tail) => [...models, ...tail]))
        : Effect.succeed(models)
    }),
  )
}

function parseModel(value: unknown): ReadonlyArray<Harness.Model> {
  if (!isRecord(value) || typeof value.id !== "string") return []
  const serviceTiers = Array.isArray(value.serviceTiers)
    ? value.serviceTiers.flatMap((tier) =>
        isRecord(tier) && typeof tier.id === "string"
          ? [
              {
                id: tier.id,
                name: typeof tier.name === "string" ? tier.name : tier.id,
                description: typeof tier.description === "string" ? tier.description : undefined,
              },
            ]
          : [],
      )
    : []
  const reasoningEfforts = Array.isArray(value.supportedReasoningEfforts)
    ? value.supportedReasoningEfforts.flatMap((item) =>
        isRecord(item) && typeof item.reasoningEffort === "string" ? [item.reasoningEffort] : [],
      )
    : []
  return [
    Harness.Model.make({
      id: value.id,
      name: typeof value.displayName === "string" ? value.displayName : value.id,
      description: typeof value.description === "string" ? value.description : undefined,
      reasoningEfforts,
      serviceTiers,
      defaultReasoningEffort:
        typeof value.defaultReasoningEffort === "string" ? value.defaultReasoningEffort : undefined,
      defaultServiceTier: typeof value.defaultServiceTier === "string" ? value.defaultServiceTier : undefined,
      isDefault: value.isDefault === true,
    }),
  ]
}

function customModels(models: ReadonlyArray<string> | undefined) {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)), (id) =>
    Harness.Model.make({ id, name: id, reasoningEfforts: [], serviceTiers: [], isDefault: false }),
  )
}

function appendCustomModels(models: ReadonlyArray<Harness.Model>, configured: ReadonlyArray<string> | undefined) {
  const known = new Set(models.map((model) => model.id))
  return [...models, ...customModels(configured).filter((model) => !known.has(model.id))]
}

function codexStream(
  runtime: Effect.Effect<CodexRuntime, unknown>,
  input: StreamInput,
  onFailure: (runtime: CodexRuntime) => Effect.Effect<void> = () => Effect.void,
) {
  return Stream.unwrap(
    runtime.pipe(
      Effect.flatMap((runtime) =>
        Effect.sync(() => {
          const prompt = renderCodexPrompt(input.request, runtime.needsHandoff)
          runtime.needsHandoff = false
          return prompt
        }).pipe(
          Effect.flatMap((prompt) =>
            runtime.client
              .request("turn/start", {
                threadId: runtime.threadID,
                input: [{ type: "text", text: prompt, text_elements: [] }],
                cwd: input.directory,
                runtimeWorkspaceRoots: [input.directory],
                model: input.model?.id,
                effort: input.model?.reasoningEffort,
                serviceTier: input.model?.serviceTier,
              })
              .pipe(
                Effect.tapError(() => onFailure(runtime)),
                Effect.map((response) => {
                  const turnID = responseTurnID(response)
                  if (!turnID) return Stream.fail(new ProtocolError("Codex did not return a turn ID."))
                  const state = codexState()
                  const output = runtime.client.notifications.pipe(
                    Stream.filter((notification) => notificationBelongsToTurn(notification, runtime.threadID, turnID)),
                    Stream.takeUntil((notification) => notification.method === "turn/completed"),
                    Stream.flatMap((notification) => Stream.fromIterable(parseCodexNotification(notification, state))),
                  )
                  return Stream.concat(Stream.make(LLMEvent.stepStart({ index: 0 })), output).pipe(
                    Stream.ensuring(
                      Effect.suspend(() =>
                        state.finished
                          ? Effect.void
                          : runtime.client
                              .request("turn/interrupt", { threadId: runtime.threadID, turnId: turnID })
                              .pipe(Effect.ignore),
                      ),
                    ),
                    Stream.catch((error) => Stream.unwrap(onFailure(runtime).pipe(Effect.as(Stream.fail(error))))),
                  )
                }),
              ),
          ),
        ),
      ),
      Effect.mapError((error) =>
        error instanceof LLMError ? error : llmError("CodexHarness", "stream", errorMessage(error)),
      ),
    ),
  ).pipe(
    Stream.mapError((error) =>
      error instanceof LLMError ? error : llmError("CodexHarness", "stream", errorMessage(error)),
    ),
  )
}

export interface CodexState {
  readonly startedText: Set<string>
  readonly emittedText: Set<string>
  readonly startedReasoning: Set<string>
  readonly emittedReasoning: Set<string>
  readonly startedTools: Set<string>
  usage?: ReturnType<typeof normalizeUsage>
  finished: boolean
  failed: boolean
}

export const codexState = (): CodexState => ({
  startedText: new Set(),
  emittedText: new Set(),
  startedReasoning: new Set(),
  emittedReasoning: new Set(),
  startedTools: new Set(),
  finished: false,
  failed: false,
})

export function parseCodexNotification(
  notification: { readonly method: string; readonly params?: unknown },
  state: CodexState,
): ReadonlyArray<LLMEvent> {
  const params = isRecord(notification.params) ? notification.params : {}
  if (notification.method === "item/agentMessage/delta") {
    const id = string(params.itemId)
    const delta = string(params.delta)
    if (!id || !delta) return []
    const start = state.startedText.has(id) ? [] : [LLMEvent.textStart({ id })]
    state.startedText.add(id)
    state.emittedText.add(id)
    return [...start, LLMEvent.textDelta({ id, text: delta })]
  }
  if (notification.method === "item/reasoning/summaryTextDelta") {
    const id = string(params.itemId)
    const delta = string(params.delta)
    if (!id || !delta) return []
    const start = state.startedReasoning.has(id) ? [] : [LLMEvent.reasoningStart({ id })]
    state.startedReasoning.add(id)
    state.emittedReasoning.add(id)
    return [...start, LLMEvent.reasoningDelta({ id, text: delta })]
  }
  if (notification.method === "item/started" || notification.method === "item/completed") {
    const item = isRecord(params.item) ? params.item : undefined
    if (!item) return []
    return codexItemEvents(notification.method, item, state)
  }
  if (notification.method === "thread/tokenUsage/updated") {
    const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : undefined
    state.usage = normalizeUsage(isRecord(tokenUsage?.last) ? tokenUsage.last : undefined)
    return []
  }
  if (notification.method === "error") {
    if (params.willRetry === true) return []
    state.failed = true
    const error = isRecord(params.error) ? params.error : undefined
    return [LLMEvent.providerError({ message: string(error?.message) ?? "Codex failed." })]
  }
  if (notification.method === "turn/completed") {
    state.finished = true
    const turn = isRecord(params.turn) ? params.turn : undefined
    const failed = turn?.status === "failed"
    state.failed = state.failed || failed
    const error = isRecord(turn?.error) ? string(turn.error.message) : undefined
    return [
      ...(failed && error ? [LLMEvent.providerError({ message: error })] : []),
      LLMEvent.stepFinish({ index: 0, reason: state.failed ? "error" : "stop", usage: state.usage }),
      LLMEvent.finish({ reason: state.failed ? "error" : "stop", usage: state.usage }),
    ]
  }
  return []
}

function codexItemEvents(method: "item/started" | "item/completed", item: Record<string, unknown>, state: CodexState) {
  const id = string(item.id)
  const type = string(item.type)
  if (!id || !type) return []
  if (type === "agentMessage") {
    if (method === "item/started") {
      state.startedText.add(id)
      return [LLMEvent.textStart({ id })]
    }
    const text = string(item.text)
    const start = state.startedText.has(id) ? [] : [LLMEvent.textStart({ id })]
    const content = text && !state.emittedText.has(id) ? [LLMEvent.textDelta({ id, text })] : []
    state.startedText.add(id)
    return [...start, ...content, LLMEvent.textEnd({ id })]
  }
  if (type === "reasoning") {
    if (method === "item/started") {
      state.startedReasoning.add(id)
      return [LLMEvent.reasoningStart({ id })]
    }
    const summary = Array.isArray(item.summary)
      ? item.summary.filter((part): part is string => typeof part === "string")
      : []
    const text = summary.join("\n")
    const start = state.startedReasoning.has(id) ? [] : [LLMEvent.reasoningStart({ id })]
    const content = text && !state.emittedReasoning.has(id) ? [LLMEvent.reasoningDelta({ id, text })] : []
    state.startedReasoning.add(id)
    return [...start, ...content, LLMEvent.reasoningEnd({ id })]
  }
  if (!isCodexTool(type)) return []
  const name = codexToolName(type)
  const call = LLMEvent.toolCall({ id, name, input: codexToolInput(item), providerExecuted: true })
  if (method === "item/started") {
    state.startedTools.add(id)
    return [call]
  }
  const start = state.startedTools.has(id) ? [] : [call]
  state.startedTools.add(id)
  const failed = item.status === "failed"
  return [
    ...start,
    LLMEvent.toolResult({
      id,
      name,
      providerExecuted: true,
      result: failed ? { type: "error", value: codexToolOutput(item) } : { type: "text", value: codexToolOutput(item) },
    }),
  ]
}

function handleCodexRequest(
  request: { readonly method: string; readonly params?: unknown },
  sessionID: SessionID,
  directory: string,
  permissions: PermissionV2.Interface,
  questions: QuestionV2.Interface,
  register: (args: unknown) => Effect.Effect<string, { readonly message: string }>,
) {
  const params = isRecord(request.params) ? request.params : {}
  if (request.method === "item/tool/call") return handleCodexToolCall(params, register)
  if (request.method === "item/commandExecution/requestApproval") {
    const command = string(params.command) ?? "command"
    return approve(permissions, {
      sessionID,
      action: "bash",
      resources: [command],
      save: [command],
      metadata: {
        harness: "codex",
        cwd: string(params.cwd) ?? directory,
        ...(string(params.reason) ? { reason: string(params.reason) } : {}),
      },
    }).pipe(Effect.map((allowed) => ({ decision: allowed ? "accept" : "decline" })))
  }
  if (request.method === "item/fileChange/requestApproval") {
    const resource = string(params.grantRoot) ?? directory
    return approve(permissions, {
      sessionID,
      action: "edit",
      resources: [resource],
      save: [resource],
      metadata: {
        harness: "codex",
        ...(string(params.reason) ? { reason: string(params.reason) } : {}),
      },
    }).pipe(Effect.map((allowed) => ({ decision: allowed ? "accept" : "decline" })))
  }
  if (request.method === "item/permissions/requestApproval") {
    const requested = isRecord(params.permissions) ? params.permissions : {}
    const resource = json(requested)
    return approve(permissions, {
      sessionID,
      action: "request_permissions",
      resources: [resource],
      save: [resource],
      metadata: {
        harness: "codex",
        cwd: string(params.cwd) ?? directory,
        ...(string(params.reason) ? { reason: string(params.reason) } : {}),
      },
    }).pipe(
      Effect.map((allowed) => ({
        permissions: allowed ? requested : {},
        scope: "turn",
      })),
    )
  }
  if (request.method === "item/tool/requestUserInput") {
    const raw = Array.isArray(params.questions) ? params.questions : []
    const items = raw.flatMap((question) => {
      if (!isRecord(question) || typeof question.id !== "string" || typeof question.question !== "string") return []
      const options = Array.isArray(question.options)
        ? question.options.flatMap((option) =>
            isRecord(option) && typeof option.label === "string"
              ? [
                  {
                    label: option.label,
                    description: typeof option.description === "string" ? option.description : "",
                  },
                ]
              : [],
          )
        : []
      return [
        {
          id: question.id,
          info: {
            header: typeof question.header === "string" ? question.header : "Codex",
            question: question.question,
            options,
            custom: question.isOther !== false,
          },
        },
      ]
    })
    return Effect.exit(questions.ask({ sessionID, questions: items.map((item) => item.info) })).pipe(
      Effect.map((exit) => ({
        answers: Object.fromEntries(
          items.map((item, index) => [
            item.id,
            { answers: Exit.isSuccess(exit) ? [...(exit.value[index] ?? [])] : [] },
          ]),
        ),
      })),
    )
  }
  return Effect.fail(new ProtocolError(`Unsupported Codex app-server request: ${request.method}`, { code: -32601 }))
}

export const codexDynamicTools = [
  {
    type: "function",
    name: "harness_register",
    description: HarnessRegistry.description,
    inputSchema: HarnessRegistry.inputJsonSchema,
  },
] as const

export function handleCodexToolCall(
  params: unknown,
  register: (args: unknown) => Effect.Effect<string, { readonly message: string }>,
) {
  const call = isRecord(params) ? params : {}
  const reply = (success: boolean, text: string) => ({ success, contentItems: [{ type: "inputText" as const, text }] })
  if (call.tool !== "harness_register" || (call.namespace ?? null) !== null)
    return Effect.succeed(reply(false, `Unknown tool: ${String(call.tool)}`))
  return register(call.arguments).pipe(
    Effect.map((text) => reply(true, text)),
    Effect.catch((error) => Effect.succeed(reply(false, error.message))),
  )
}

function approve(permissions: PermissionV2.Interface, input: PermissionV2.AssertInput) {
  return Effect.exit(permissions.assert(input)).pipe(Effect.map(Exit.isSuccess))
}

function readContinuation(
  db: Database.Interface["db"],
  sessionID: SessionID,
  instanceID: Harness.InstanceID,
  revision: number,
) {
  return db
    .select({ metadata: SessionTable.metadata })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => {
        const continuation = isRecord(row?.metadata?.harnessContinuation) ? row.metadata.harnessContinuation : undefined
        const storedRevision = typeof continuation?.revision === "number" ? continuation.revision : 0
        return continuation?.instanceID === instanceID && storedRevision === revision
          ? string(continuation.value)
          : undefined
      }),
    )
}

function renderCodexInstructions(request: LLMRequest) {
  return request.system
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n\n")
}

export function renderCodexPrompt(request: LLMRequest, includeHistory = false) {
  if (includeHistory) {
    // ponytail: The runner already normalizes and compacts this history. Add Harness-specific budgeting only if a driver rejects it.
    const transcript = request.messages
      .map((message) => `${message.role.toUpperCase()}:\n${renderMessage(message)}`)
      .filter((message) => !message.endsWith(":\n"))
      .join("\n\n")
    return `Continue this existing Run. Its canonical conversation follows. Respond to the final user message.\n\n${transcript}`
  }
  const latest = request.messages.findLast((message) => message.role === "user")
  if (latest) return renderMessage(latest)
  return request.messages.map(renderMessage).filter(Boolean).join("\n\n")
}

function renderMessage(message: Message) {
  return message.content.flatMap(renderContent).join("\n")
}

function renderContent(part: ContentPart): ReadonlyArray<string> {
  if (part.type === "text") return [part.text]
  if (part.type === "media") return [`[Attached ${part.filename ?? part.mediaType}]`]
  if (part.type === "tool-call") return [`[Tool call: ${part.name}] ${json(part.input)}`]
  if (part.type === "tool-result") return [`[Tool result: ${part.name}] ${json(part.result.value)}`]
  return []
}

function normalizeUsage(value: Record<string, unknown> | undefined) {
  if (!value) return undefined
  const inputTokens = number(value.inputTokens)
  const cachedInputTokens = number(value.cachedInputTokens) ?? 0
  return {
    inputTokens,
    nonCachedInputTokens: inputTokens === undefined ? undefined : Math.max(0, inputTokens - cachedInputTokens),
    cacheReadInputTokens: cachedInputTokens,
    cacheWriteInputTokens: number(value.cacheWriteInputTokens),
    outputTokens: number(value.outputTokens),
    reasoningTokens: number(value.reasoningOutputTokens),
    totalTokens: number(value.totalTokens),
  }
}

function notificationBelongsToTurn(notification: { readonly params?: unknown }, threadID: string, turnID: string) {
  const params = isRecord(notification.params) ? notification.params : undefined
  if (!params) return false
  return params.threadId === threadID && (params.turnId === undefined || params.turnId === turnID)
}

function isCodexTool(type: string) {
  return type === "commandExecution" || type === "fileChange" || type === "mcpToolCall" || type === "webSearch"
}

function codexToolName(type: string) {
  if (type === "commandExecution") return "command_execution"
  if (type === "fileChange") return "file_change"
  if (type === "mcpToolCall") return "mcp_tool_call"
  return "web_search"
}

function codexToolInput(item: Record<string, unknown>) {
  if (item.type === "commandExecution") return { command: item.command, cwd: item.cwd }
  if (item.type === "fileChange") return { changes: item.changes }
  if (item.type === "mcpToolCall") return { server: item.server, tool: item.tool, arguments: item.arguments }
  if (item.type === "webSearch") return { query: item.query }
  return {}
}

function codexToolOutput(item: Record<string, unknown>) {
  const value = item.aggregatedOutput ?? item.result ?? item.changes ?? item.error ?? "Completed"
  const output = typeof value === "string" ? value : json(value)
  return output.length > 32_000 ? `${output.slice(0, 32_000)}\n[Output truncated]` : output
}

function responseThreadID(value: unknown) {
  if (!isRecord(value) || !isRecord(value.thread)) return undefined
  return string(value.thread.id)
}

function responseTurnID(value: unknown) {
  if (!isRecord(value) || !isRecord(value.turn)) return undefined
  return string(value.turn.id)
}

function readAccount(value: unknown) {
  const record = isRecord(value) ? value : undefined
  const authenticated = record?.account !== null && record?.account !== undefined
  return { authenticated, available: authenticated || record?.requiresOpenaiAuth === false }
}

function readVersion(value: unknown) {
  const userAgent = isRecord(value) ? string(value.userAgent) : undefined
  return userAgent?.match(/\/([^\s]+)/)?.[1]
}

function recoverableResume(error: unknown) {
  const message = errorMessage(error).toLowerCase()
  return ["not found", "missing thread", "no such thread", "unknown thread", "does not exist", "no rollout"].some(
    (part) => message.includes(part),
  )
}

function expandHome(input: string) {
  const value = input.trim()
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2))
  return path.resolve(value)
}

function llmError(module: string, method: string, message: string) {
  return new LLMError({
    module,
    method,
    reason:
      module === "HarnessRuntime" ? new InvalidProviderOutputReason({ message }) : new TransportReason({ message }),
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Codex process failed."
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

export function withProviderIdleTimeout<A, E, R>(stream: Stream.Stream<A, E, R>) {
  return stream.pipe(
    Stream.timeoutOrElse({
      duration: "2 minutes",
      orElse: () =>
        Stream.fail(
          llmError(
            "HarnessRuntime",
            "stream",
            "The provider stopped responding for two minutes. Retry the request or choose another provider.",
          ),
        ),
    }),
  )
}
