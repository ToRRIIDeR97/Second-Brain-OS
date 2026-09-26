import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("opens Home with the managed sidecar's mixed API", async ({ page }, testInfo) => {
  const unsupported: string[] = []
  const bootstrapErrors: string[] = []
  page.on("console", (message) => {
    if (message.text().includes("Failed to finish bootstrap")) bootstrapErrors.push(message.text())
  })
  await mockOpenCodeServer(page, {
    protocol: "v2",
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  // The managed sidecar combines current sessions with legacy projects and MCP.
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/health" || path === "/global/health") return route.fulfill({ json: { healthy: true } })
    if (path.startsWith("/api/project") || path.startsWith("/api/mcp")) {
      unsupported.push(path)
      return route.fulfill({ status: 404, json: { error: "Not Found" } })
    }
    return route.fallback()
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })
  const projects = page.waitForResponse((response) => new URL(response.url()).pathname === "/project")
  await page.goto("/")
  expect((await projects).ok()).toBe(true)
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
  await page.locator("header").getByRole("button", { name: "Open Workspace", exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces$/)
  await expect(page.getByRole("textbox", { name: "Search sessions" })).toBeEditable()
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
  expect(unsupported).toEqual([])
  expect(bootstrapErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("startup.png"), fullPage: true })
})
