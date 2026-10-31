import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { handleCodexRequest, turnGate, type StreamInput } from "../src/harness"
import { handleRequest, type PermissionRequest } from "../src/harness/acp"
import type { PermissionV2 } from "../src/permission"
import type { QuestionV2 } from "../src/question"
import { SessionID } from "@opencode-ai/schema/session-id"

const sessionID = SessionID.make("ses_permission_source")

describe("harness approvals", () => {
  test("link a Codex approval to the item it gates", async () => {
    const asserted: PermissionV2.AssertInput[] = []
    const permissions = {
      assert: (input: PermissionV2.AssertInput) => Effect.sync(() => void asserted.push(input)),
    } as unknown as PermissionV2.Interface
    const input: StreamInput = {
      sessionID,
      directory: "/work",
      request: {} as StreamInput["request"],
      permissionSource: (callID) => Effect.succeed({ type: "tool", messageID: "msg_1", callID }),
    }
    const result: unknown = await Effect.runPromise<unknown, unknown>(
      handleCodexRequest(
        { method: "item/commandExecution/requestApproval", params: { itemId: "item_7", command: "ls" } },
        input,
        permissions,
        {} as QuestionV2.Interface,
        turnGate().guard,
      ),
    )
    expect(result).toEqual({ decision: "accept" })
    expect(asserted[0]?.source).toEqual({ type: "tool", messageID: "msg_1", callID: "item_7" })
  })

  test("pass the ACP toolCallId with the permission request", async () => {
    const requests: PermissionRequest[] = []
    await Effect.runPromise(
      handleRequest(
        {
          id: 1,
          method: "session/request_permission",
          params: {
            toolCall: { toolCallId: "call_3", kind: "execute", title: "ls" },
            options: [{ kind: "allow_once", optionId: "yes" }],
          },
        },
        (request) => Effect.sync(() => requests.push(request)).pipe(Effect.as(true)),
      ),
    )
    expect(requests[0]?.callID).toBe("call_3")
  })
})
