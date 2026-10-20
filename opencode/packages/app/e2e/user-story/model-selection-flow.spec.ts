import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { openFolderFromWorkspaceMenu } from "../utils/sidebar"

const directory = "C:/OpenCode/NewProject"

test("opens a project from the sidebar, connects OpenCode Go, and selects its model in a new thread", async ({
  page,
}) => {
  let connectedGo = false
  let pendingGo = false
  const connections: Array<{ integrationID: string; body: unknown }> = []

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "opencode-go",
          name: "OpenCode Go",
          models: {
            "go-model-1": {
              id: "go-model-1",
              name: "Go Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: connectedGo ? ["opencode", "opencode-go"] : ["opencode"],
      default: { providerID: "opencode", modelID: "free-model" },
    }),
    integrationMethods: { "opencode-go": [{ type: "api", label: "API key" }] },
    onConnectKey: (input) => {
      connections.push(input)
      if (input.integrationID === "opencode-go") pendingGo = true
    },
    onInstanceDispose: () => {
      if (pendingGo) connectedGo = true
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: {} }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })

  // Navigation is sidebar-only: open the folder from the workspace menu, then start a new-thread draft.
  await page.goto("/")
  await expectAppVisible(page.getByRole("button", { name: "Switch workspace" }))
  await openFolderFromWorkspaceMenu(page)
  await page.locator("[data-directory-path]").click()

  // The opened folder becomes the selected workspace; its General group offers the new-thread draft.
  const brain = page.locator('[data-sidebar-group="__brain__"]')
  await expect(brain).toBeVisible()
  await brain.getByRole("button", { name: "General" }).click()
  await brain.locator("[data-sidebar-new-thread]").click()
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))

  // The generic model picker lists connected models; OpenCode Go is not connected yet.
  const modelControl = page.locator('[data-action="prompt-model"]')
  await modelControl.click()
  await expect(page.locator('[data-option-key="opencode:free-model"]')).toHaveAttribute("data-selected-model", "true")
  await expect(page.locator('[data-option-key="opencode-go:go-model-1"]')).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-option-key="opencode:free-model"]')).toHaveCount(0)

  await page.getByRole("button", { name: /Connect to 75\+ providers/ }).click()
  await page.locator('[data-provider-id="opencode-go"]').click()
  await page.locator('[data-input="provider-api-key"]').fill("mock-go-api-key")
  await page.locator('[data-action="provider-connect-submit"]').click()
  await expect(page.locator('[data-component="dialog-v2"]')).toHaveCount(0)
  expect(connections).toEqual([{ integrationID: "opencode-go", body: { type: "api", key: "mock-go-api-key" } }])

  await expect(modelControl).toHaveAttribute("data-control-type", "popover")
  await modelControl.click()
  const goModel = page.locator('[data-option-key="opencode-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.click()

  await expect(modelControl).toContainText("Go Model 1")
})
