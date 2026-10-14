import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const brain = fixture.directory
const repo = "C:/OpenCode/Repo"
const scratch = "C:/Temp/scratch"

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

const thread = (id: string, directory: string, title: string, created: number, parentID?: string) => ({
  id,
  slug: id,
  projectID: fixture.project.id,
  directory,
  title,
  parentID,
  version: "dev",
  time: { created, updated: created },
})

async function openApp(page: Page, input: { projects: unknown[]; sessions: ReturnType<typeof thread>[] }) {
  await mockOpenCodeServer(page, {
    sessions: input.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
    projectThreads: input.projects,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: {} }),
    )
  }, brain)
}

const sidebar = (page: Page) => page.locator('[data-component="second-brain-sidebar"]')

for (const entry of ["/", "/brain", "/workspaces"]) {
  test(`opens Brain home from ${entry}`, async ({ page }) => {
    await openApp(page, { projects: [], sessions: [] })
    await page.goto(entry)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
  })
}

test("the sidebar is the only navigation", async ({ page }) => {
  await openApp(page, { projects: [], sessions: [] })
  await page.goto("/")
  await expect(page.locator('[data-slot="titlebar-tab-item"]')).toHaveCount(0)

  for (const [item, path] of [
    ["notes", /\/notes$/],
    ["calendar", /\/calendar$/],
    ["activity", /\/activity$/],
    ["overview", /\/$/],
  ] as const) {
    await sidebar(page).locator(`[data-sidebar-item="${item}"]`).click()
    await expect(page).toHaveURL(path)
  }
  await sidebar(page).getByRole("button", { name: "Projects", exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
})

test("groups threads by Project, Brain and Other threads, and starts a thread in a Project", async ({ page }) => {
  await openApp(page, {
    projects: [project],
    sessions: [
      thread("ses_repo", repo, "Repo thread", 1_700_000_000_000),
      thread("ses_child", repo, "Repo child thread", 1_700_000_000_500, "ses_repo"),
      thread("ses_brain", brain, "Brain thread", 1_700_000_001_000),
      thread("ses_scratch", scratch, "Scratch thread", 1_700_000_002_000),
    ],
  })
  await page.goto("/")

  const projectGroup = sidebar(page).locator('[data-sidebar-project="prj_repo"]')
  await projectGroup.getByRole("button", { name: "Repo project" }).click()
  await expect(projectGroup.getByText("Repo thread", { exact: true })).toBeVisible()
  // Child threads stay folded under their parent until that lineage is open.
  await expect(projectGroup.getByText("Repo child thread", { exact: true })).toHaveCount(0)
  await expect(projectGroup.getByText("Brain thread", { exact: true })).toHaveCount(0)

  const brainGroup = sidebar(page).locator('[data-sidebar-group="__brain__"]')
  await brainGroup.getByRole("button", { name: "Brain", exact: true }).click()
  await expect(brainGroup.getByText("Brain thread", { exact: true })).toBeVisible()

  const otherGroup = sidebar(page).locator('[data-sidebar-group="__other__"]')
  await otherGroup.getByRole("button", { name: "Other threads", exact: true }).click()
  await expect(otherGroup.getByText("Scratch thread", { exact: true })).toBeVisible()

  await projectGroup.locator("[data-sidebar-new-thread]").click()
  await expect(page).toHaveURL(/\/new-thread\?project=prj_repo&draftId=[^&]+$/)
  await expect(page.locator('[data-slot="titlebar-tab-item"]')).toHaveCount(0)
})

test("archiving a thread can be undone with mod+z", async ({ page }) => {
  const repoThread = thread("ses_repo", repo, "Repo thread", 1_700_000_000_000)
  await openApp(page, { projects: [project], sessions: [repoThread] })
  const updates: unknown[] = []
  await page.route(/\/session\/ses_repo(\?|$)/, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback()
    const body = route.request().postDataJSON() as { time?: { archived?: number | null } }
    updates.push(body)
    const archived = body.time?.archived ?? undefined
    // Keep the mock's session list in step with the server's archive state.
    Object.assign(repoThread.time, { archived })
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ ...repoThread, time: { ...repoThread.time, archived } }),
    })
  })
  await page.goto("/")

  const projectGroup = sidebar(page).locator('[data-sidebar-project="prj_repo"]')
  await projectGroup.getByRole("button", { name: "Repo project" }).click()
  const row = projectGroup.locator('[data-sidebar-thread="ses_repo"]')
  await row.hover()
  await row.getByRole("button", { name: "Thread actions" }).click()
  await page.getByRole("menuitem", { name: "Archive" }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByText("Thread archived", { exact: true })).toBeVisible()

  // mod+z belongs to text fields while one has focus; elsewhere it undoes the archive.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const mod = (await page.evaluate(() => /(Mac|iPod|iPhone|iPad)/.test(navigator.platform))) ? "Meta" : "Control"
  await page.keyboard.press(`${mod}+z`)
  await expect(row).toBeVisible()
  await expect(page.getByText("Thread archived", { exact: true })).toHaveCount(0)
  expect(updates).toEqual([{ time: { archived: expect.any(Number) } }, { time: { archived: null } }])
})
