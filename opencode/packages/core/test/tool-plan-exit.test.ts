import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { PlanExitTool } from "@opencode-ai/core/tool/plan-exit"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_plan_exit_tool_test")
let answer = "Yes"
const published: { type: string; data: unknown }[] = []
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const question = Layer.succeed(
  QuestionV2.Service,
  QuestionV2.Service.of({
    ask: () => Effect.sync(() => [[answer]]),
    reply: () => Effect.die("unused"),
    reject: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const events = Layer.succeed(EventV2.Service, {
  publish: (definition: { type: string }, data: unknown) => Effect.sync(() => void published.push({ type: definition.type, data })),
} as unknown as EventV2.Interface)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, PlanExitTool.node]), [
    [PermissionV2.node, permission],
    [QuestionV2.node, question],
    [EventV2.node, events],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)
const call = (id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "plan_exit", input: {} },
})

describe("PlanExitTool", () => {
  it.effect("switches the Session to the build agent when the user approves", () =>
    Effect.gen(function* () {
      published.length = 0
      answer = "Yes"
      const result = yield* settleTool(yield* ToolRegistry.Service, call("call-plan-yes"))
      expect(result.result).toEqual({ type: "text", value: expect.stringContaining("Execute the plan") })
      expect(published).toMatchObject([{ type: "session.next.agent.switched", data: { sessionID, agent: "build" } }])
    }),
  )

  it.effect("stays in plan mode when the user declines", () =>
    Effect.gen(function* () {
      published.length = 0
      answer = "No"
      const result = yield* settleTool(yield* ToolRegistry.Service, call("call-plan-no"))
      expect(result.result).toEqual({ type: "error", value: expect.stringContaining("keep refining the plan") })
      expect(published).toEqual([])
    }),
  )
})
