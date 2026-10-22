import { describe, expect } from "bun:test"
import {
  LLMClient,
  LLMError,
  LLMEvent,
  Model,
  TransportReason,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Harness } from "@opencode-ai/schema/harness"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { HarnessRuntime } from "@opencode-ai/core/harness"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { QuestionV2 } from "@opencode-ai/core/question"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { eq } from "drizzle-orm"
import { Effect, Layer, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { testEffect } from "./lib/effect"

// Title calls go through the LLM client; turn replies come from the harness runtime, so the two never mix.
const titleRequests: LLMRequest[] = []
let titleReply = "<think>naming</think>\nFix login redirect\n"
let titleFails = false
let titleHangs = false
let titleAbandoned = false
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      titleRequests.push(request)
      if (titleHangs)
        return Stream.never.pipe(
          Stream.ensuring(
            Effect.sync(() => {
              titleAbandoned = true
            }),
          ),
        )
      if (titleFails)
        return Stream.fail(
          new LLMError({ module: "test", method: "stream", reason: new TransportReason({ message: "down" }) }),
        )
      return Stream.fromIterable([
        LLMEvent.textStart({ id: "title" }),
        LLMEvent.textDelta({ id: "title", text: titleReply }),
        LLMEvent.textEnd({ id: "title" }),
        LLMEvent.finish({ reason: "stop" }),
      ])
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const turn = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "reply" }),
  LLMEvent.textDelta({ id: "reply", text: "Done" }),
  LLMEvent.textEnd({ id: "reply" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]
const harnessID = Harness.InstanceID.make("fake-acp")
const harnesses = Layer.mock(HarnessRuntime.Service, {
  driver: (id) => (id === harnessID ? Harness.DriverKind.make("acp") : Harness.OpenCodeDriver),
  stream: () => Stream.fromIterable(turn),
})

const models = SessionRunnerModel.layerWith((session) =>
  Effect.succeed(
    Model.make({
      id: session.model?.id ?? "default-model",
      provider: session.model?.providerID ?? "fake",
      route: OpenAIChat.route,
    }),
  ),
)
const catalog = Layer.mock(Catalog.Service, {
  provider: {
    get: () => Effect.succeed(undefined),
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
  },
  model: {
    get: () => Effect.succeed(undefined),
    all: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
    getAvailable: () => Effect.succeed(undefined),
    default: () => Effect.succeed(undefined),
    small: (providerID) =>
      Effect.succeed(
        providerID === "fake" ? ModelV2.Info.empty(providerID, ModelV2.ID.make("small-model")) : undefined,
      ),
  },
})
const permission = Layer.mock(PermissionV2.Service, {})
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const systemContext = AppNodeBuilder.build(SystemContextRegistry.node)
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const replacements = [
  [LayerNodePlatform.llmClient, client],
  [HarnessRuntime.node, harnesses],
  [Catalog.node, catalog],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [PermissionV2.node, permission],
  [Config.node, config],
  [Snapshot.node, Snapshot.noopLayer],
] as const
const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [...replacements])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runnerLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      ToolRegistry.node,
      SessionRunnerModel.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [...replacements, [SessionExecution.node, execution]],
  ),
)

const sessionID = SessionV2.ID.make("ses_title_test")
const defaultTitle = `New session - ${new Date(0).toISOString()}`

const setup = (input: { harness?: boolean; agentModel?: boolean } = {}) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const agents = yield* AgentV2.Service
    titleRequests.length = 0
    titleReply = "<think>naming</think>\nFix login redirect\n"
    titleFails = false
    titleHangs = false
    titleAbandoned = false
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("title"), (info) => {
        info.hidden = true
        info.system = "You generate thread titles."
        if (input.agentModel)
          info.model = { id: ModelV2.ID.make("title-model"), providerID: ProviderV2.ID.make("fake") }
      }),
    )
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: sessionID,
        directory: "/project",
        title: defaultTitle,
        version: "test",
        metadata: input.harness ? { harnessInstanceID: harnessID } : undefined,
        model: input.harness ? undefined : { id: "main", providerID: "fake" },
      })
      .run()
      .pipe(Effect.orDie)
  })

const ask = (text: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    yield* session.prompt({ sessionID, prompt: Prompt.make({ text }), resume: false })
    yield* session.resume(sessionID)
  })

// The title runs in a background fiber; let it finish before reading the stored title.
const settle = Effect.gen(function* () {
  for (let index = 0; index < 200; index++) yield* Effect.yieldNow
})

const storedTitle = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
  return row?.title
})

const assistantReplies = Effect.gen(function* () {
  const session = yield* SessionV2.Service
  return (yield* session.messages({ sessionID })).filter((message) => message.type === "assistant").length
})

describe("session runner titles", () => {
  it.effect("titles an in-process session with the provider's small model after its first turn", () =>
    Effect.gen(function* () {
      yield* setup()
      yield* ask("Users land on /login after signing in")
      yield* settle

      expect(yield* storedTitle).toBe("Fix login redirect")
      expect(titleRequests).toHaveLength(1)
      expect(titleRequests[0]?.model.id as string | undefined).toBe("small-model")
      expect(titleRequests[0]?.tools).toEqual([])
      expect(titleRequests[0]?.system.map((part) => part.text)).toEqual(["You generate thread titles."])
      expect(
        titleRequests[0]?.messages.flatMap((message) =>
          message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
        ),
      ).toEqual(["Generate a title for this conversation:\nUsers land on /login after signing in"])
    }),
  )

  it.effect("prefers the title agent's configured model", () =>
    Effect.gen(function* () {
      yield* setup({ agentModel: true })
      yield* ask("Rename the settings tab")
      yield* settle

      expect(titleRequests[0]?.model.id as string | undefined).toBe("title-model")
      expect(yield* storedTitle).toBe("Fix login redirect")
    }),
  )

  it.effect("titles a harness session with a host model", () =>
    Effect.gen(function* () {
      yield* setup({ harness: true })
      yield* ask("Explore the harness code")
      yield* settle

      expect(titleRequests).toHaveLength(1)
      expect(titleRequests[0]?.model.id as string | undefined).toBe("default-model")
      expect(yield* storedTitle).toBe("Fix login redirect")
    }),
  )

  it.effect("keeps the default title when the title call fails, and the turn still completes", () =>
    Effect.gen(function* () {
      yield* setup()
      titleFails = true
      yield* ask("Users land on /login after signing in")
      yield* settle

      expect(titleRequests).toHaveLength(1)
      expect(yield* storedTitle).toBe(defaultTitle)
      expect(yield* assistantReplies).toBe(1)
    }),
  )

  it.effect("gives up on a title call after 30 seconds and keeps the default title", () =>
    Effect.gen(function* () {
      yield* setup()
      titleHangs = true
      yield* ask("Users land on /login after signing in")
      yield* settle

      expect(titleRequests).toHaveLength(1)
      expect(yield* assistantReplies).toBe(1)
      yield* TestClock.adjust("29 seconds")
      yield* settle
      expect(titleAbandoned).toBe(false)

      yield* TestClock.adjust("1 second")
      yield* settle
      expect(titleAbandoned).toBe(true)
      expect(yield* storedTitle).toBe(defaultTitle)
    }),
  )

  it.effect("keeps the default title when the reply cleans to nothing", () =>
    Effect.gen(function* () {
      yield* setup()
      titleReply = "<think>only thinking</think>\n  \n"
      yield* ask("Hello")
      yield* settle

      expect(titleRequests).toHaveLength(1)
      expect(yield* storedTitle).toBe(defaultTitle)
    }),
  )

  it.effect("does not retitle on a second user turn", () =>
    Effect.gen(function* () {
      yield* setup()
      titleFails = true
      yield* ask("First question")
      yield* settle
      titleFails = false
      titleRequests.length = 0

      yield* ask("Second question")
      yield* settle

      expect(titleRequests).toHaveLength(0)
      expect(yield* storedTitle).toBe(defaultTitle)
      expect(yield* assistantReplies).toBe(2)
    }),
  )
})
