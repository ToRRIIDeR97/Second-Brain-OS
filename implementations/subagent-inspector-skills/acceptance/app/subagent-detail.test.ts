import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { normalizeSessionMessages } from "../../../../opencode/packages/app/src/utils/session-message"
import { subagentDetail } from "../../../../opencode/packages/app/src/components/session/subagent-detail"

const transcript = [
  { type: "reasoning", text: "Plan: grep" },
  { type: "tool", tool: "acp_search", title: "grep -rn harness", status: "completed", output: "14 hits" },
  { type: "text", text: "Found 3." },
]

function subagentPart(usage?: Record<string, unknown>) {
  const source = [
    { id: "msg_user", type: "user", text: "audit", time: { created: 1 } },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "opencode", providerID: "opencode-acp" },
      content: [
        {
          type: "tool",
          id: "sub",
          name: "acp_subagent",
          state: {
            status: "completed",
            input: { description: "Find usages", prompt: "Find harness call sites", subagent_type: "explore" },
            content: [{ type: "text", text: "3 call sites" }],
          },
          provider: { executed: true, resultMetadata: { acp: { steps: [], transcript, ...(usage ? { usage } : {}) } } },
          time: { created: 2, ran: 2, completed: 5 },
        },
      ],
      time: { created: 2, completed: 5 },
    },
  ] as unknown as SessionMessageInfo[]
  const parts = normalizeSessionMessages("ses_1", source).parts.get("msg_assistant") ?? []
  return parts.find((part) => part.type === "tool") as ToolPart
}

describe("AC-5 app mapping", () => {
  test("AC-5 the transcript and usage reach the tool part metadata", () => {
    const part = subagentPart({ used: 41000, size: 200000 })
    expect(part.metadata?.acpSubagent).toMatchObject({ transcript, usage: { used: 41000, size: 200000 } })
  })
})

describe("AC-8 subagent detail", () => {
  test("AC-8 conversation starts with the prompt, then the transcript", () => {
    const detail = subagentDetail(subagentPart())
    expect(detail.agent).toBe("explore")
    expect(detail.status).toBe("completed")
    expect(detail.prompt).toBe("Find harness call sites")
    expect(detail.transcript).toEqual(transcript)
  })

  test("AC-8 context shows used, size and percent", () => {
    const detail = subagentDetail(subagentPart({ used: 50000, size: 200000 }))
    expect(detail.context).toEqual({ used: 50000, size: 200000, percent: 25 })
  })

  test("AC-8 cache hit comes from reported token fields", () => {
    const detail = subagentDetail(
      subagentPart({ used: 1, size: 10, inputTokens: 1000, outputTokens: 200, cachedReadTokens: 3000, cachedWriteTokens: 0 }),
    )
    expect(detail.usage).toMatchObject({ input: 1000, output: 200, cacheRead: 3000, cacheWrite: 0, cacheHit: 0.75 })
  })

  test("AC-8 values the harness didn't report stay undefined, never 0", () => {
    const detail = subagentDetail(subagentPart({ used: 50000, size: 200000 }))
    expect(detail.usage.input).toBeUndefined()
    expect(detail.usage.cacheHit).toBeUndefined()
  })
})
