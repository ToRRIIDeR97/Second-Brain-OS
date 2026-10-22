import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { createSessionTabs } from "../../../../opencode/packages/app/src/pages/session/helpers"
import { normalizeSessionMessages } from "../../../../opencode/packages/app/src/utils/session-message"
import { subagentDetail } from "../../../../opencode/packages/app/src/components/session/subagent-detail"
import { skillSections } from "../../../../opencode/packages/app/src/components/settings-v2/skills-sections"

function activeTab(active: string | undefined, all: string[]) {
  return createRoot((dispose) => {
    const [state] = createStore({ active, all })
    const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
    const value = createSessionTabs({
      tabs,
      pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice(7) : undefined),
      normalizeTab: (tab) => tab,
    }).activeTab()
    dispose()
    return value
  })
}

function runningPart(structured: Record<string, unknown>) {
  const source = [
    { id: "u", type: "user", text: "go", time: { created: 1 } },
    {
      id: "a",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "opencode-acp" },
      content: [
        {
          type: "tool",
          id: "sub",
          name: "acp_subagent",
          state: { status: "running", input: { description: "Audit", subagent_type: "general" }, structured },
          time: { created: 2, ran: 2 },
        },
      ],
      time: { created: 2 },
    },
  ] as unknown as SessionMessageInfo[]
  return (normalizeSessionMessages("ses", source).parts.get("a") ?? []).find((part) => part.type === "tool") as ToolPart
}

describe("verify AC-6 tab fallback", () => {
  test("AC-6 with nothing active, a file tab wins over an agent tab", () => {
    expect(activeTab(undefined, ["agent://p1", "file://a.ts"])).toBe("file://a.ts")
  })

  test("AC-6 with only an agent tab open, it becomes active", () => {
    expect(activeTab(undefined, ["agent://p1", "context"])).toBe("agent://p1")
  })
})

describe("verify AC-5 / AC-8 running subagent detail", () => {
  test("AC-5 a running subagent shows its live transcript", () => {
    const part = runningPart({ acp: { steps: [], transcript: [{ type: "text", text: "working" }], truncated: true } })
    const detail = subagentDetail(part)
    expect(detail.status).toBe("running")
    expect(detail.agent).toBe("general")
    expect(detail.transcript).toEqual([{ type: "text", text: "working" }])
    expect(detail.truncated).toBe(true)
  })

  test("AC-8 percent rounds, and is absent without a size", () => {
    expect(subagentDetail(runningPart({ acp: { transcript: [], usage: { used: 1, size: 3 } } })).context).toEqual({
      used: 1,
      size: 3,
      percent: 33,
    })
    expect(subagentDetail(runningPart({ acp: { transcript: [], usage: { used: 5 } } })).context?.percent).toBeUndefined()
  })

  test("AC-8 a subagent with no usage at all has no context", () => {
    expect(subagentDetail(runningPart({ acp: { transcript: [] } })).context).toBeUndefined()
  })

  test("AC-8 cost passes through", () => {
    expect(subagentDetail(runningPart({ acp: { transcript: [], usage: { used: 1, size: 2, cost: 0.5 } } })).usage.cost).toBe(0.5)
  })
})

describe("verify AC-11 sections", () => {
  test("AC-11 an empty catalog still shows the Tenon section", () => {
    expect(skillSections({ tenon: [], harnesses: [] })).toEqual([
      { id: "tenon", title: "Tenon", editable: true, source: "filesystem", skills: [] },
    ])
  })

  test("AC-11 harness order and source are kept", () => {
    const sections = skillSections({
      tenon: [],
      harnesses: [
        { id: "z", name: "Zed", source: "reported", skills: [{ name: "b", scope: "global" }, { name: "A", scope: "global" }] },
        { id: "a", name: "Aider", source: "none", skills: [] },
      ],
    })
    expect(sections.map((section) => [section.id, section.source])).toEqual([
      ["tenon", "filesystem"],
      ["z", "reported"],
      ["a", "none"],
    ])
    expect(sections[1].skills.map((skill) => skill.name)).toEqual(["A", "b"])
  })
})
