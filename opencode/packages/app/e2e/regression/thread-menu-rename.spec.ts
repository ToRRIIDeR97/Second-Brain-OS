import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const brain = fixture.directory
const repo = "C:/OpenCode/Repo"

const project = {
  project: {
    id: "prj_repo",
    folder: "projects/prj_repo",
    name: "Repo project",
    outcome: "Ship it",
    instructions: "",
    status: "active",
    progressPercent: 0,
    tags: [],
    location: { workspaceId: "proj_repo", displayPath: repo },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  threadDirectory: repo,
  threadDirectoryKind: "workspace",
  workspace: { id: "proj_repo", worktree: repo },
  rootSessionCount: 1,
  lastActivityAt: null,
}

async function openThreadMenu(page: Page) {
  const repoThread = {
    id: "ses_repo",
    slug: "ses_repo",
    projectID: fixture.project.id,
    directory: repo,
    title: "Repo thread",
    version: "dev",
    time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  }
  await mockOpenCodeServer(page, {
    sessions: [repoThread],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
    projectThreads: [project],
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: {} }),
    )
  }, brain)
  const renames: unknown[] = []
  await page.route(/\/session\/ses_repo(\?|$)/, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    const body = route.request().postDataJSON() as { title?: string }
    renames.push(body)
    if (body.title) repoThread.title = body.title
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(repoThread),
    })
  })
  await page.goto("/")

  const projectGroup = page.locator('[data-component="second-brain-sidebar"] [data-sidebar-project="prj_repo"]')
  await projectGroup.getByRole("button", { name: "Repo project" }).click()
  const row = projectGroup.locator('[data-sidebar-thread="ses_repo"]')
  await expect(row.getByText("Repo thread", { exact: true })).toBeVisible()
  await row.hover()
  await row.getByRole("button", { name: "Thread actions" }).click()
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  return { row, renames }
}

async function renameTo(page: Page, row: ReturnType<Page["locator"]>, renames: unknown[]) {
  const input = row.getByRole("textbox", { name: "Thread title" })
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await page.keyboard.type("Renamed thread")
  await page.keyboard.press("Enter")
  await expect(input).toHaveCount(0)
  await expect(row.getByText("Renamed thread", { exact: true })).toBeVisible()
  expect(renames).toEqual([{ title: "Renamed thread" }])
}

test("pressing R in a thread's menu starts a rename that Enter saves", async ({ page }) => {
  const { row, renames } = await openThreadMenu(page)
  await page.keyboard.press("r")
  await renameTo(page, row, renames)
})

test("Escape cancels a rename started from the menu without saving", async ({ page }) => {
  const { row, renames } = await openThreadMenu(page)
  await page.keyboard.press("r")
  const input = row.getByRole("textbox", { name: "Thread title" })
  await expect(input).toBeFocused()
  await page.keyboard.type("Discarded")
  await page.keyboard.press("Escape")
  await expect(input).toHaveCount(0)
  await expect(row.getByText("Repo thread", { exact: true })).toBeVisible()
  expect(renames).toEqual([])
})

test("clicking Rename in a thread's menu starts a rename that Enter saves", async ({ page }) => {
  const { row, renames } = await openThreadMenu(page)
  await page.getByRole("menuitem", { name: "Rename" }).click()
  await renameTo(page, row, renames)
})
