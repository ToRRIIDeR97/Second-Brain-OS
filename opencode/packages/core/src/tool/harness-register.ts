export * as HarnessRegisterTool from "./harness-register"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { HarnessRuntime } from "../harness"
import { HarnessRegistry } from "../harness/registry"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "harness_register"

export const Output = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  agentName: Schema.String.pipe(Schema.optional),
  version: Schema.String.pipe(Schema.optional),
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const harness = yield* HarnessRuntime.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: HarnessRegistry.description,
          input: HarnessRegistry.Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: HarnessRegistry.summary(output) }],
          execute: (input, context) =>
            harness
              .register(input, {
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/harness-register",
  layer,
  deps: [ToolRegistry.node, HarnessRuntime.node],
})
