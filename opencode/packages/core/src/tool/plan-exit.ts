export * as PlanExitTool from "./plan-exit"

import { ToolFailure } from "@opencode-ai/llm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "plan_exit"

export const description = `Use this tool when you have completed the planning phase and are ready to exit plan agent.

This tool will ask the user if they want to switch to build agent to start implementing the plan.

Call this tool:
- After you have written a complete plan to the plan file
- After you have clarified any questions with the user
- When you are confident the plan is ready for implementation

Do NOT call this tool:
- Before you have created or finalized the plan
- If you still have unanswered questions about the implementation
- If the user has indicated they want to continue planning`

export const Input = Schema.Struct({})

export const Output = Schema.Struct({
  agent: Schema.String,
})
export type Output = typeof Output.Type

const YES = "Yes"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const question = yield* QuestionV2.Service
    const permission = yield* PermissionV2.Service
    const events = yield* EventV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          // The switch itself is hidden from the model, so the result says what changed.
          toModelOutput: () => [
            {
              type: "text",
              text: `The user approved the plan. You are now the ${AgentV2.defaultID} agent and can edit files. Execute the plan.`,
            },
          ],
          execute: (_input, context) =>
            Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
              yield* permission
                .assert({ action: name, resources: ["*"], sessionID: context.sessionID, agent: context.agent, source })
                .pipe(Tool.mapError(() => new ToolFailure({ message: `Permission denied: ${name}` })))
              const answers = yield* question
                .ask({
                  sessionID: context.sessionID,
                  questions: [
                    {
                      question: "The plan is complete. Switch to the build agent and start implementing it?",
                      header: "Build Agent",
                      custom: false,
                      options: [
                        { label: YES, description: "Switch to the build agent and start implementing the plan" },
                        { label: "No", description: "Stay with the plan agent to keep refining the plan" },
                      ],
                    },
                  ],
                  tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                .pipe(Effect.orDie)
              if (answers[0]?.[0] !== YES)
                return yield* new ToolFailure({ message: "The user wants to keep refining the plan." })
              // The runner selects the Session's agent each step, so the next step runs as the build agent.
              yield* events.publish(SessionEvent.AgentSwitched, {
                sessionID: context.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                agent: AgentV2.defaultID,
              })
              return { agent: AgentV2.defaultID }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/plan_exit",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, QuestionV2.node, EventV2.node],
})
