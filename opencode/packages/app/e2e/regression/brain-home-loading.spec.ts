import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("Home remains usable during loading and reuses fresh harness availability", async ({ page }, testInfo) => {
  await mockOpenCodeServer(page, {
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
    },
    { directory: fixture.directory },
  )
  const now = new Date()
  await page.clock.setFixedTime(now)
  const date = await page.evaluate(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  })
  const projects = Promise.withResolvers<void>()
  const calendar = Promise.withResolvers<void>()
  const harness = Promise.withResolvers<void>()
  const refresh = Promise.withResolvers<void>()
  let harnessRequests = 0
  await page.route("**/api/harness?**", async (route) => {
    harnessRequests++
    await (harnessRequests === 1 ? harness.promise : refresh.promise)
    await route.fulfill({
      json: {
        location: { directory: fixture.directory, project: { id: fixture.project.id, directory: fixture.directory } },
        data: [{ id: "opencode", driver: "opencode", name: "OpenCode", status: "available", models: [] }],
      },
    })
  })
  await page.route("**/second-brain/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/second-brain/projects") {
      await projects.promise
      return route.fulfill({
        json: [
          {
            id: "project_loading",
            folder: "projects/loading",
            name: "Loading test project",
            outcome: "Responsive Home",
            instructions: "",
            status: "active",
            progressPercent: 25,
            tags: [],
            createdAt: date,
            updatedAt: date,
          },
        ],
      })
    }
    if (path === "/second-brain/calendar") {
      await calendar.promise
      return route.fulfill({
        json: {
          version: 2,
          revision: "1",
          events: [{ id: "event_loading", title: "Loading test event", date, source: "local", syncState: "local" }],
          tasks: [],
        },
      })
    }
    return route.fallback()
  })
  const home = page.getByRole("heading", { name: "Home", exact: true })
  const prompt = page.getByRole("textbox", { name: "Start a Run", exact: true })
  const selector = page.getByRole("group", { name: "Harness", exact: true }).getByRole("button")
  const start = page.getByRole("button", { name: "Start", exact: true })
  try {
    await page.goto("/brain")
    await expect(home).toBeVisible()
    await prompt.fill("A draft while data loads")
    await expect(prompt).toHaveValue("A draft while data loads")
    await expect(start).toBeDisabled()
    await expect(page.getByText("Checking harnesses…", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("home-pending.png"), fullPage: true })

    // Navigation works even when all three Home requests are still pending.
    await page.locator('[data-sidebar-item="activity"]').click()
    await expect(home).not.toBeVisible()
    await page.locator('[data-sidebar-item="overview"]').click()
    await expect(prompt).toBeEditable()
    await prompt.fill("Still usable")
    expect(harnessRequests).toBe(1)

    calendar.resolve()
    await expect(page.getByRole("button", { name: /Loading test event/ })).toBeVisible()
    projects.resolve()
    await expect(page.getByRole("button", { name: /Loading test project/ })).toBeVisible()
    await expect(start).toBeDisabled()
    harness.resolve()
    await expect(selector).toBeEnabled()
    await expect(selector).toHaveText("OpenCode")
    await expect(start).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath("home-loaded.png"), fullPage: true })

    await page.locator('[data-sidebar-item="projects"]').click()
    await expect(home).not.toBeVisible()
    await page.locator('[data-sidebar-item="overview"]').click()
    await expect(selector).toBeEnabled()
    await expect(selector).toHaveText("OpenCode")
    expect(harnessRequests).toBe(1)

    // Advance freshness without a sleep. A stale result stays usable during refresh.
    await page.clock.setFixedTime(new Date(now.getTime() + 31_000))
    await page.locator('[data-sidebar-item="projects"]').click()
    await expect(home).not.toBeVisible()
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/harness")
    await page.locator('[data-sidebar-item="overview"]').click()
    await requested
    await expect(selector).toBeEnabled()
    await expect(selector).toHaveText("OpenCode")
    await prompt.fill("A draft during background refresh")
    await expect(start).toBeEnabled()
    expect(harnessRequests).toBe(2)
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/harness")
    refresh.resolve()
    await refreshed
    await expect(selector).toBeEnabled()
  } finally {
    projects.resolve()
    calendar.resolve()
    harness.resolve()
    refresh.resolve()
  }
})
