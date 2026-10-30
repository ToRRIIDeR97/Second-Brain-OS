import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { normalizeSessionMessages } from "../../../../opencode/packages/app/src/utils/session-message"
// message-part.tsx imports a Vite worker URL that bun can't load, so the renderer choice is tested where it lives.
import { toolRendererName } from "../../../../opencode/packages/session-ui/src/components/tool-alias"

describe("AC-11 an ACP edit renders as a diff", () => {
  test("acp_edit with one diff gets filePath and filediff", () => {
    const source = [
      { id: "msg_u", type: "user", text: "edit", time: { created: 1 } },
      {
        id: "msg_a",
        type: "assistant",
        agent: "build",
        model: { id: "sonnet", providerID: "claude-code" },
        content: [
          {
            type: "tool",
            id: "e1",
            name: "acp_edit",
            provider: { executed: true, resultMetadata: { acp: { diffs: [{ path: "/w/a.ts", oldText: "one", newText: "two" }] } } },
            state: { status: "completed", input: { title: "Edit a.ts" }, content: [{ type: "text", text: "Edited /w/a.ts" }], structured: {} },
            time: { created: 2, completed: 3 },
          },
        ],
        time: { created: 2 },
      },
    ] as unknown as SessionMessageInfo[]
    const part = normalizeSessionMessages("ses_1", source).parts.get("msg_a")?.find((item) => item.id === "e1")
    expect(part?.type).toBe("tool")
    if (part?.type !== "tool" || part.state.status !== "completed") throw new Error("expected a completed tool")
    expect(part.state.input.filePath).toBe("/w/a.ts")
    expect(part.state.metadata.filediff).toMatchObject({ file: "/w/a.ts", before: "one", after: "two" })
    expect(toolRendererName("acp_edit")).toBe("edit")
  })
})

describe("AC-14 harness commands use the shell view", () => {
  test("command_execution and acp_execute render like shell", () => {
    expect(toolRendererName("command_execution")).toBe("shell")
    expect(toolRendererName("acp_execute")).toBe("shell")
    expect(toolRendererName("bash")).toBe("shell")
    expect(toolRendererName("read")).toBe("read")
  })
})
