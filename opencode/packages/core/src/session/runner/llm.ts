import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  Model,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { RequestExecutor } from "@opencode-ai/llm/route"
import { Harness } from "@opencode-ai/schema/harness"
import { Cause, DateTime, Effect, FiberSet, Layer, Option, Scope, Semaphore, Stream } from "effect"
import { eq } from "drizzle-orm"
import { AgentV2 } from "../../agent"
import { Catalog } from "../../catalog"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { Tool } from "../../tool/tool"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionTable } from "../sql"
import { SessionTitle } from "../title"
import { SessionV1 } from "../../v1/session"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { DEFAULT_MAX_STEPS, DOOM_LOOP_THRESHOLD, MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { HarnessRuntime } from "../../harness"

const harnessRequestModel = (session: SessionSchema.Info) =>
  Model.make({
    id: session.harnessModel?.id ?? session.harnessInstanceID,
    provider: session.harnessInstanceID,
    route: OpenAIChat.route,
  })

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor agent step limits, defaulting to DEFAULT_MAX_STEPS.
 *   - [x] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [x] Update the title in bounded background work.
 *   - [ ] Update summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const harnesses = yield* HarnessRuntime.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const permissions = yield* PermissionV2.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const catalog = yield* Catalog.Service
    const scope = yield* Scope.Scope
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    // Title model for the in-process agent: the title agent's model, then the small model of the provider
    // behind the session's own model (host sessions only) or else the catalog default, then that model itself.
    const titleModel = Effect.fn("SessionRunner.titleModel")(function* (
      session: SessionSchema.Info,
      agent: AgentV2.Info,
    ) {
      const resolve = (model: SessionSchema.Info["model"]) =>
        models.resolve({ ...session, model }).pipe(Effect.option, Effect.map(Option.getOrUndefined))
      const configured = agent.model ? yield* resolve(agent.model) : undefined
      if (configured) return configured
      const base =
        (harnesses.driver(session.harnessInstanceID) === Harness.OpenCodeDriver
          ? yield* resolve(session.model)
          : undefined) ?? (yield* resolve(undefined))
      const small = base ? yield* catalog.model.small(ProviderV2.ID.make(base.provider)) : undefined
      const smallModel = small ? yield* resolve({ id: small.id, providerID: small.providerID }) : undefined
      return smallModel ?? base
    })

    const generateTitle = Effect.fn("SessionRunner.generateTitle")(function* (sessionID: SessionSchema.ID) {
      const session = yield* getSession(sessionID)
      // Cheap checks first, so named and child sessions don't reload their history every run.
      if (session.parentID || !SessionTitle.isDefault(session.title)) return
      const users = (yield* getContext(sessionID)).filter(
        (message): message is SessionMessage.User => message.type === "user",
      )
      if (
        !users[0] ||
        !SessionTitle.eligible({ parentID: session.parentID, title: session.title, userMessages: users.length })
      )
        return
      const agent = yield* agents.get(AgentV2.ID.make("title"))
      if (!agent) return
      const system = agent.system ? [SystemPart.make(agent.system)] : []
      const messages = [Message.user(SessionTitle.prompt(users[0]))]
      // The thread's own agent titles it, unless settings name a harness that is still known.
      const preferred = yield* harnesses.titleAgent()
      const instanceID = preferred && harnesses.driver(preferred) ? preferred : session.harnessInstanceID
      const text =
        harnesses.driver(instanceID) === Harness.OpenCodeDriver
          ? yield* Effect.gen(function* () {
              const model = yield* titleModel(session, agent)
              if (!model) return ""
              return yield* llm.stream(LLM.request({ model, system, messages, tools: [] })).pipe(
                Stream.filter(LLMEvent.is.textDelta),
                Stream.map((event) => event.text),
                Stream.mkString,
                // A stalled title call must not hold a fiber for the life of the runner.
                Effect.timeout(TITLE_TIMEOUT),
              )
            })
          : // An external agent starts a fresh process and session for the title, so it gets longer.
            yield* harnesses
              .complete({
                instanceID,
                directory: session.location.directory,
                request: LLM.request({ model: harnessRequestModel(session), system, messages, tools: [] }),
                model: instanceID === session.harnessInstanceID ? session.harnessModel : undefined,
              })
              .pipe(Effect.timeout(HARNESS_TITLE_TIMEOUT))
      const title = SessionTitle.clean(text)
      if (!title) return
      // Re-read so a rename made while the title was generating wins, and the snapshot is current.
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
      if (!row || !SessionTitle.isDefault(row.title)) return
      yield* events.publish(SessionV1.Event.Updated, { sessionID, info: SessionTitle.renamed(row, title) })
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (agent: AgentV2.Selection) =>
      Effect.all([systemContext.load(), skillGuidance.load(agent), referenceGuidance.load()], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
          // The queued input was withdrawn after the runner saw it pending; there is nothing to answer.
          if (promoted === 0) return { needsContinuation: false, step: currentStep }
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const driver = harnesses.driver(session.harnessInstanceID)
      const usesHostModel = driver === Harness.OpenCodeDriver
      const model = usesHostModel
        ? yield* models.resolve(session).pipe(
            // Resolution fails before the provider publisher exists; record a failed step so the
            // Session shows the error instead of waiting for a reply that never starts.
            Effect.tapError((error) =>
              createLLMEventPublisher(events, {
                sessionID: session.id,
                agent: agent.id,
                model: session.model ?? { id: ModelV2.ID.make("none"), providerID: ProviderV2.ID.make("none") },
              }).failAssistant(error.message),
            ),
          )
        : harnessRequestModel(session)
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const isLastStep = currentStep >= (agent.info?.steps ?? DEFAULT_MAX_STEPS)
      const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(agent.info?.permissions)
      const recentCalls = localToolCallsSinceLastUser(context)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        http: {
          headers: {
            "x-session-affinity": session.id,
            "X-Session-Id": session.id,
            ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
          },
        },
        providerOptions: { openai: { promptCacheKey } },
        system: [agent.info?.system, system.baseline]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      if (usesHostModel && (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request })))
        return yield* Effect.die(continueAfterCompaction(currentStep))
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(usesHostModel ? model.id : (session.harnessModel?.id ?? model.id)),
          providerID: ProviderV2.ID.make(usesHostModel ? model.provider : session.harnessInstanceID),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        harnessInstanceID: session.harnessInstanceID,
        harnessModel: session.harnessModel,
        snapshot: startSnapshot,
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      // Suspended so each retry attempt opens a fresh provider stream.
      const providerStream = Stream.suspend(() =>
        harnesses.stream({
          instanceID: session.harnessInstanceID,
          sessionID: session.id,
          directory: session.location.directory,
          request,
          model: session.harnessModel,
          revision: session.harnessRevision ?? 0,
        }),
      ).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            const input = JSON.stringify(event.input)
            const repeated =
              recentCalls.length >= DOOM_LOOP_THRESHOLD - 1 &&
              recentCalls
                .slice(-(DOOM_LOOP_THRESHOLD - 1))
                .every((call) => call.name === event.name && call.input === input)
            recentCalls.push({ name: event.name, input })
            // Like V1, ask before running the same call a third time in a row; a denial becomes the tool result.
            const guard = repeated
              ? permissions
                  .assert({
                    sessionID: session.id,
                    agent: agent.id,
                    action: "doom_loop",
                    resources: [event.name],
                    save: [event.name],
                    metadata: { tool: event.name, input: event.input },
                    source: { type: "tool", messageID: assistantMessageID, callID: event.id },
                  })
                  .pipe(
                    Effect.as(undefined),
                    Effect.catch((error) =>
                      Effect.succeed({
                        result: {
                          type: "error" as const,
                          value:
                            error._tag === "Session.NotFoundError"
                              ? `Repeated ${event.name} call was not allowed`
                              : Tool.permissionFailure(error).message,
                        },
                      }),
                    ),
                  )
              : Effect.succeed(undefined)
            yield* Effect.uninterruptibleMask((restore) =>
              restore(
                guard.pipe(
                  Effect.flatMap((denied) =>
                    denied
                      ? Effect.succeed(denied)
                      : toolMaterialization.settle({
                          sessionID: session.id,
                          agent: agent.id,
                          assistantMessageID,
                          call: event,
                        }),
                  ),
                ),
              ).pipe(
                Effect.flatMap((settlement) =>
                  publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: settlement.result,
                      output: settlement.output,
                    }),
                    settlement.outputPaths ?? [],
                  ),
                ),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )
      // Retry a failed provider call only while nothing was published for it, so a retry never
      // duplicates assistant output. Harness drivers own their own transport and are not retried here.
      const runProvider = (attempt: number): typeof providerStream =>
        providerStream.pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              // An empty step that already finished cannot be replayed: the publisher records one step finish.
              const delay =
                usesHostModel &&
                !publisher.hasAssistantStarted() &&
                !publisher.stepSettlement() &&
                !publisher.hasProviderError() &&
                !overflowFailure
                  ? providerRetryDelay(error, attempt)
                  : undefined
              if (delay === undefined || !(error instanceof LLMError)) return yield* Effect.fail(error)
              yield* events.publish(SessionEvent.Retried, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                attempt: attempt + 1,
                error: { message: error.reason.message, statusCode: providerStatus(error), isRetryable: true },
              })
              yield* Effect.sleep(delay)
              return yield* runProvider(attempt + 1)
            }),
          ),
        )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(runProvider(0).pipe(Effect.provideService(RequestExecutor.MaxRetries, 0))).pipe(
            Effect.exit,
          )
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            usesHostModel &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          )
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          // Defects and non-provider failures must still close the step, or the Session shows a reply that never ends.
          if (
            stream._tag === "Failure" &&
            !llmFailure &&
            !Cause.hasInterrupts(stream.cause) &&
            !publisher.hasProviderError()
          ) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant("Internal error while processing the provider response"))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !publisher.hasProviderError()) {
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: stepSettlement.cost,
                contextWindow: stepSettlement.contextWindow,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
              }),
            )
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          return { needsContinuation: !publisher.hasProviderError() && needsContinuation, step: currentStep }
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
    ) => Effect.Effect<{ readonly needsContinuation: boolean; readonly step: number }, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step, compaction.compactAfterOverflow).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
            return yield* runTurn(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      if (!input.force && !hasSteer && !hasQueue) return
      yield* failInterruptedTools(input.sessionID)
      let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue
      let titleStarted = false
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        while (needsContinuation) {
          const result = yield* runTurn(input.sessionID, promotion, step)
          if (!titleStarted) {
            titleStarted = true
            // Runs beside the turn in the runner's scope; a failure only leaves the default title.
            yield* generateTitle(input.sessionID).pipe(
              Effect.catchCause((cause) =>
                Effect.logError("failed to generate session title", {
                  sessionID: input.sessionID,
                  error: Cause.squash(cause),
                }),
              ),
              Effect.forkIn(scope),
            )
          }
          needsContinuation = result.needsContinuation
          step = result.step + 1
          promotion = "steer"
          if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        }
        shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
        promotion = shouldRun ? "queue" : undefined
      }
    })

    return Service.of({
      run,
    })
  }),
)

/** Local tool calls after the latest user message, oldest first, for the repeated-call guard. */
const localToolCallsSinceLastUser = (context: ReadonlyArray<SessionMessage.Message>) =>
  context
    .slice(context.findLastIndex((message) => message.type === "user") + 1)
    .flatMap((message) =>
      message.type !== "assistant"
        ? []
        : message.content.flatMap((part) =>
            part.type === "tool" && part.state.status !== "pending" && part.provider?.executed !== true
              ? [{ name: part.name, input: JSON.stringify(part.state.input) }]
              : [],
          ),
    )

const TITLE_TIMEOUT = "30 seconds"
const HARNESS_TITLE_TIMEOUT = "90 seconds"

const PROVIDER_RETRY_LIMIT = 5
const PROVIDER_RETRY_BASE_MS = 2_000
const PROVIDER_RETRY_MAX_BACKOFF_MS = 30_000
// A provider asking for a longer pause fails the turn instead of holding the Session busy; retry notices
// are not surfaced in the UI yet, so keep each wait (and the five-attempt total) short.
const PROVIDER_RETRY_MAX_WAIT_MS = 60_000

/** Milliseconds to wait before retrying a failed provider call, or undefined when it must not be retried. */
const providerRetryDelay = (error: unknown, attempt: number) => {
  if (!(error instanceof LLMError) || !error.retryable || attempt >= PROVIDER_RETRY_LIMIT) return undefined
  const backoff =
    Math.min(PROVIDER_RETRY_BASE_MS * 2 ** attempt, PROVIDER_RETRY_MAX_BACKOFF_MS) * (0.8 + Math.random() * 0.4)
  const delay = Math.max(error.retryAfterMs ?? 0, Math.round(backoff))
  return delay > PROVIDER_RETRY_MAX_WAIT_MS ? undefined : delay
}

const providerStatus = (error: LLMError) => {
  if ("status" in error.reason && error.reason.status !== undefined) return error.reason.status
  return "http" in error.reason ? error.reason.http?.response?.status : undefined
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    HarnessRuntime.node,
    AgentV2.node,
    Catalog.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    PermissionV2.node,
    Snapshot.node,
    Database.node,
  ],
})
