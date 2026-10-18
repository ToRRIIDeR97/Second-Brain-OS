import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const model = (id: string, name: string, isDefault: boolean) => ({
  id,
  name,
  reasoningEfforts: ["low", "medium", "high"],
  serviceTiers: [],
  defaultReasoningEffort: "low",
  isDefault,
})

test("Home starts a thread with the model and reasoning picked for its harness", async ({ page }) => {
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
  await page.route("**/api/harness?**", (route) =>
    route.fulfill({
      json: {
        location: { directory: fixture.directory, project: { id: fixture.project.id, directory: fixture.directory } },
        data: [
          { id: "opencode", driver: "opencode", name: "Default agent", status: "available", models: [] },
          {
            id: "codex",
            driver: "codex",
            name: "Codex",
            status: "available",
            models: [model("gpt-5.6-sol", "GPT-5.6 Sol", true), model("gpt-5.6-luna", "GPT-5.6 Luna", false)],
          },
        ],
      },
    }),
  )
  const created = Promise.withResolvers<Record<string, unknown>>()
  await page.route(
    (url) => url.pathname === "/api/session",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      created.resolve(route.request().postDataJSON())
      return route.fulfill({ status: 500, json: { name: "UnknownError", data: { message: "stop after create" } } })
    },
  )

  await page.goto("/")
  await page.getByRole("button", { name: "Harness", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click()

  const modelPicker = page.getByRole("button", { name: "Model", exact: true })
  await expect(modelPicker).toHaveText("GPT-5.6 Sol")
  await modelPicker.click()
  await page.getByRole("menuitemradio", { name: "GPT-5.6 Luna", exact: true }).click()
  await expect(modelPicker).toHaveText("GPT-5.6 Luna")

  const effort = page.getByRole("button", { name: "Effort", exact: true })
  await expect(effort).toHaveText("low")
  await effort.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(effort).toHaveText("high")

  await page.getByRole("textbox", { name: "Start a Run", exact: true }).fill("Check the routes.")
  await page.getByRole("button", { name: "Start", exact: true }).click()

  expect(await created.promise).toMatchObject({
    harnessInstanceID: "codex",
    harnessModel: { id: "gpt-5.6-luna", reasoningEffort: "high" },
  })
})
