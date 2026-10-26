import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("Harness picker puts external agents in one group with an add action", async ({ page }, testInfo) => {
  await mockOpenCodeServer(page, {
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
    },
    { directory: fixture.directory },
  )
  const harness = (id: string, driver: string, name: string) => ({ id, driver, name, status: "available", models: [] })
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: fixture.directory, project: { id: fixture.project.id, directory: fixture.directory } },
        // Server order puts a built-in external agent before the native loop; the picker regroups it.
        data: [
          harness("codex", "codex", "Codex"),
          harness("opencode", "opencode", "Default agent"),
          harness("opencode-acp", "acp", "OpenCode"),
          harness("claude-code", "acp", "Claude Code"),
          harness("gemini", "acp", "Gemini"),
        ],
      },
    }),
  )

  await page.goto("/")
  const selector = page.getByRole("button", { name: "Harness", exact: true })
  await expect(selector).toBeEnabled()
  await selector.click()

  const list = page.getByRole("menu")
  await expect(list.getByRole("menuitemradio")).toHaveText([
    "Default agent",
    "Codex",
    "OpenCode",
    "Claude Code",
    "Gemini",
  ])
  await expect(list.getByText("External agents", { exact: true })).toBeVisible()
  const add = list.getByRole("menuitem", { name: "Add harness", exact: true })
  await page.screenshot({ path: testInfo.outputPath("harness-picker-groups.png") })

  await add.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Harnesses" })).toHaveAttribute("aria-selected", "true")
})
