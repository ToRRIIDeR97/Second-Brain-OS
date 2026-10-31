import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HarnessRuntime } from "@opencode-ai/core/harness"
import { HarnessDelegation } from "@opencode-ai/core/harness/delegation"
import { HarnessDelegationTasks } from "@opencode-ai/core/harness/delegation-tasks"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { SessionV2 } from "@opencode-ai/core/session"

const parent = { id: "ses_parent", location: { directory: "/work" }, harnessInstanceID: "opencode" }
let created = 0
const sessions = Layer.succeed(SessionV2.Service, {
  get: (id: string) => Effect.succeed(id === parent.id ? parent : { ...parent, id, parentID: parent.id }),
  // Slow enough that every call in a batch passes the limit check before any child registers.
  create: (input: { parentID: string }) =>
    Effect.sleep("20 millis").pipe(Effect.as({ ...parent, id: `ses_child_${++created}`, parentID: input.parentID })),
  prompt: () => Effect.void,
  resume: () => Effect.never,
  interrupt: () => Effect.void,
  messages: () => Effect.succeed([]),
  active: Effect.succeed(new Set()),
} as unknown as SessionV2.Interface)
const runtime = Layer.succeed(HarnessRuntime.Service, {
  list: () => Effect.succeed([{ id: "codex", name: "Codex", status: "available", models: [] }]),
} as unknown as HarnessRuntime.Interface)
const locations = Layer.succeed(LocationServiceMap.Service, {
  get: () => runtime,
} as unknown as LocationServiceMap.Service["Service"])

test("a batch of delegate calls can't start more tasks than the limit", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(HarnessDelegationTasks.layer.pipe(Layer.provide(Layer.mergeAll(sessions, locations))))
        const batch = Array.from({ length: HarnessDelegationTasks.MAX_RUNNING + 3 }, (_, index) =>
          HarnessDelegation.invoke("delegate_task", { agent: "codex", task: `task ${index}`, wait_seconds: 0 }, parent.id)
            .then(() => "started" as const)
            .catch(() => "refused" as const),
        )
        const outcomes = yield* Effect.promise(() => Promise.all(batch))
        expect(outcomes.filter((outcome) => outcome === "started")).toHaveLength(HarnessDelegationTasks.MAX_RUNNING)
        expect(created).toBe(HarnessDelegationTasks.MAX_RUNNING)
      }),
    ),
  )
})
