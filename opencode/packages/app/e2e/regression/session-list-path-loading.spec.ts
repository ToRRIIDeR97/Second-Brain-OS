import { test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

test("shows loaded sessions before the directory path request resolves", async ({ page }) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })

  let releasePath!: () => void
  const pathBlocked = new Promise<void>((resolve) => {
    releasePath = resolve
  })
  await page.route("**/api/path?*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("location[directory]")) return route.fallback()
    await pathBlocked
    return route.fallback()
  })

  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  try {
    // The Brain folder's threads are listed in the sidebar's Brain group.
    const brain = page.locator('[data-component="second-brain-sidebar"] [data-sidebar-group="__brain__"]')
    await brain.getByRole("button", { name: "Brain", exact: true }).click()
    await expectAppVisible(brain.getByText(fixture.expected.sourceTitle, { exact: true }))
  } finally {
    releasePath()
  }
})
