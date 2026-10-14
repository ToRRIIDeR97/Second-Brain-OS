import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  completedAssistantInfo,
  messageUpdated,
  partUpdated,
  setupTimeline,
  shell,
  status,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("groups singleton and separated context operations at correct boundaries", async ({ page }) => {
  const parts = [
    toolPart("prt_boundary_01_read", "read", "completed", { filePath: "src/a.ts" }),
    textPart("prt_boundary_02_text", "Boundary text"),
    toolPart("prt_boundary_03_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
    toolPart("prt_boundary_04_grep", "grep", "completed", { path: ".", pattern: "stable" }),
    shell("prt_boundary_05_shell", "completed", "done"),
    toolPart("prt_boundary_06_list", "list", "completed", { path: "src" }),
  ]
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

  await expect(page.locator('[data-timeline-part-ids="prt_boundary_01_read"]')).toBeVisible()
  // A completed shell between context tools folds the whole run into one "tools" summary row.
  const tools = page.locator(
    '[data-timeline-part-ids="prt_boundary_03_glob,prt_boundary_04_grep,prt_boundary_05_shell,prt_boundary_06_list"]',
  )
  await expect(tools).toBeVisible()
  await expect(tools.getByRole("button", { name: /^Ran 4 tool/ })).toBeVisible()
  await expect(page.locator('[data-timeline-row="AssistantPart"]')).toHaveCount(3)

  await tools.getByRole("button", { name: /^Ran 4 tool/ }).click()
  for (const id of ["prt_boundary_03_glob", "prt_boundary_04_grep", "prt_boundary_05_shell", "prt_boundary_06_list"]) {
    await expect(tools.locator(`[data-timeline-part-id="${id}"]`), id).toBeVisible()
  }
})

test("reducer-hardening: converges when idle arrives before final part and message completion", async ({ page }) => {
  const textID = "prt_event_order_text"
  const assistant = assistantMessage([textPart(textID, "Partial")], { completed: false })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant] })
  await timeline.send(status("busy"), 100)
  await timeline.send(status("idle"), 100)
  await timeline.send(partUpdated(textPart(textID, "Final after early idle")), 120)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant.info)), 250)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${textID}"]`)).toContainText("Final after early idle")
})
