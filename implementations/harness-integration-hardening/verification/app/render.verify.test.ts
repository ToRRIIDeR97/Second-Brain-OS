import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { normalizeSessionMessages } from "../../../../opencode/packages/app/src/utils/session-message"

describe("verify AC-11 app side", () => {
  test("an acp_edit with two diffs keeps its own input, and a running edit has no diff yet", () => {
    const tool = (id: string, provider: unknown, status: string) => ({
      type: "tool",
      id,
      name: "acp_edit",
      ...(provider ? { provider } : {}),
      state: { status, input: { title: "Edit" }, content: status === "completed" ? [{ type: "text", text: "Edited" }] : [], structured: {} },
      time: { created: 2, completed: 3 },
    })
    const source = [
      { id: "msg_u", type: "user", text: "x", time: { created: 1 } },
      {
        id: "msg_a",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "claude-code" },
        content: [
          tool(
            "two",
            { executed: true, resultMetadata: { acp: { diffs: [{ path: "/a", oldText: "1", newText: "2" }, { path: "/b", oldText: "3", newText: "4" }] } } },
            "completed",
          ),
          tool("live", undefined, "running"),
        ],
        time: { created: 2 },
      },
    ] as unknown as SessionMessageInfo[]
    const parts = normalizeSessionMessages("ses_1", source).parts.get("msg_a") ?? []
    const state = (id: string) => {
      const part = parts.find((item) => item.id === id)
      return part?.type === "tool" ? (part.state as { input: Record<string, unknown>; metadata?: Record<string, unknown> }) : undefined
    }
    expect(state("two")?.input.filePath).toBeUndefined()
    expect(state("live")?.metadata?.filediff).toBeUndefined()
  })
})
