import { describe, expect } from "bun:test"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool/tool"
import { testEffect } from "./lib/effect"
import { toolIdentity } from "./lib/tool"

const it = testEffect(Layer.empty)

const failingTool = (error: unknown) =>
  Tool.make({
    description: "Fails with the given error",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () =>
      Effect.fail(error).pipe(Tool.mapError(() => new ToolFailure({ message: "Unable to run failing tool" }))),
  })

const settleError = (error: unknown) =>
  Tool.settle(
    failingTool(error),
    { type: "tool-call", id: "call-failing", name: "failing", input: {} },
    { sessionID: SessionV2.ID.make("ses_tool_test"), ...toolIdentity, toolCallID: "call-failing" },
  ).pipe(Effect.flip)

describe("Tool.settle", () => {
  it.effect("shows the user's rejection feedback to the model", () =>
    Effect.gen(function* () {
      const failure = yield* settleError(new PermissionV2.CorrectedError({ feedback: "use rg instead" }))
      expect(failure.message).toBe(
        "The user rejected permission to use this specific tool call with the following feedback: use rg instead",
      )
    }),
  )

  it.effect("tells the model a permission rule denied the call", () =>
    Effect.gen(function* () {
      const failure = yield* settleError(
        new PermissionV2.BlockedError({ rules: [{ action: "bash", resource: "rm *", effect: "deny" }] }),
      )
      expect(failure.message).toContain("prevents you from using this specific tool call")
      expect(failure.message).toContain('"resource":"rm *"')
    }),
  )

  it.effect("keeps the tool's own mapping for other errors", () =>
    Effect.gen(function* () {
      const failure = yield* settleError(new Error("boom"))
      expect(failure.message).toBe("Unable to run failing tool")
    }),
  )
})
