import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

for (const entry of ["/", "/brain"]) {
  test(`opens Brain home from ${entry} and preserves workspace management`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      sessions: [],
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages: () => ({ items: [] }),
    })
    await page.addInitScript(() => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
    })

    await page.goto(entry)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
    await page.locator("header").getByRole("button", { name: "Open Workspace", exact: true }).click()
    await expect(page).toHaveURL(/\/workspaces$/)
    await expect(page.locator('[data-action="home-add-project-row"]')).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Search sessions" })).toBeVisible()
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
  })
}
