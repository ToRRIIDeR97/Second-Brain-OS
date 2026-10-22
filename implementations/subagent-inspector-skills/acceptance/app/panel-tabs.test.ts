import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createSessionTabs } from "../../../../opencode/packages/app/src/pages/session/helpers"

const fileTab = (tab: string) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined)

function tabsFor(active: string | undefined, all: string[]) {
  return createRoot((dispose) => {
    const [state] = createStore({ active, all })
    const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
    const result = createSessionTabs({ tabs, pathFromTab: fileTab, normalizeTab: (tab) => tab })
    const snapshot = {
      activeTab: result.activeTab(),
      activeFileTab: result.activeFileTab(),
      closableTab: result.closableTab(),
      agentTabs: result.agentTabs(),
      openedTabs: result.openedTabs(),
    }
    dispose()
    return snapshot
  })
}

describe("AC-6 agent tabs in the right panel", () => {
  test("AC-6 an active agent tab is the panel's active, closable tab", () => {
    const result = tabsFor("agent://prt_1", ["file://src/a.ts", "agent://prt_1", "context"])
    expect(result.activeTab).toBe("agent://prt_1")
    expect(result.closableTab).toBe("agent://prt_1")
  })

  test("AC-6 agent tabs are listed in order and are not file tabs", () => {
    const result = tabsFor("agent://prt_2", ["agent://prt_1", "file://src/a.ts", "agent://prt_2"])
    expect(result.agentTabs).toEqual(["agent://prt_1", "agent://prt_2"])
    expect(result.activeFileTab).toBeUndefined()
    expect(result.openedTabs).not.toContain("agent://prt_1")
  })
})
