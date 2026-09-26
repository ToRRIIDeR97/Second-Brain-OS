import { expect, test, type Page } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import type { NoteDocument, ProjectRecord } from "../../src/features/second-brain/client"

async function setup(page: Page, spanish = false) {
  await mockOpenCodeServer(page, {
    sessions: [],
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, spanish }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
      if (spanish) localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "es" }))
    },
    { directory: fixture.directory, spanish },
  )
  const date = new Date().toLocaleDateString("en-CA")
  const project: ProjectRecord = {
    id: "project_audit",
    folder: "projects/project_audit",
    name: "Audit Project",
    outcome: "An editable outcome",
    instructions: "",
    status: "active",
    progressPercent: 25,
    tags: [],
    createdAt: date,
    updatedAt: date,
  }
  const notes: NoteDocument[] = [
    {
      info: {
        path: "notes/alpha.md",
        title: "Alpha",
        projectIds: [project.id],
        tags: [],
        links: ["Beta"],
        updatedAt: date,
      },
      body: "# First heading\n\nUnique-body-needle and [[Beta]].",
      revision: "1",
    },
    {
      info: {
        path: "notes/beta.md",
        title: "Beta Updated",
        projectIds: [project.id],
        tags: [],
        links: [],
        updatedAt: date,
      },
      body: "# Beta body",
      revision: "1",
    },
  ]
  await page.route("**/second-brain/**", async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith("/second-brain/")) return route.fallback()
    const method = route.request().method()
    if (url.pathname === "/second-brain/projects") return route.fulfill({ json: [project] })
    if (url.pathname === "/second-brain/project") {
      if (method === "PATCH") Object.assign(project, route.request().postDataJSON())
      return route.fulfill({ json: project })
    }
    if (url.pathname === "/second-brain/notes") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase()
      return route.fulfill({
        json: notes
          .filter((note) => !search || `${note.info.title} ${note.body}`.toLowerCase().includes(search))
          .map((note) => note.info),
      })
    }
    if (url.pathname === "/second-brain/note") {
      const note = notes.find((item) => item.info.path === url.searchParams.get("path"))
      if (method === "PUT") {
        const body = route.request().postDataJSON()
        if (body.create && note) return route.fulfill({ status: 409, json: {} })
        if (note) {
          note.body = body.body
          note.info.title = body.title
          note.revision = "2"
        }
      }
      return route.fulfill({ json: note })
    }
    if (url.pathname === "/second-brain/calendar")
      return route.fulfill({
        json: {
          version: 2,
          revision: "1",
          events: [{ id: "event_audit", title: "Audit Event", date, source: "local", syncState: "local" }],
          tasks: [
            {
              id: "task_audit",
              title: "Audit Task",
              dueDate: date,
              projectId: project.id,
              source: "local",
              syncState: "local",
              createdAt: date,
              updatedAt: date,
            },
          ],
        },
      })
    return route.fulfill({ status: 404, json: {} })
  })
}

test("notes preserve edits across navigation, search bodies, render headings and stable wiki links", async ({
  page,
}, testInfo) => {
  await setup(page)
  await page.goto("/notes?note=notes%2Falpha.md")
  await expect(page.getByRole("heading", { name: "First heading" })).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: testInfo.outputPath("note-preview.png"), fullPage: true })
  await page.getByRole("link", { name: "Beta", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Beta body" })).toBeVisible()
  await page.getByRole("textbox", { name: "Search notes" }).fill("Unique-body-needle")
  await expect(
    page.getByRole("navigation", { name: "Notes", exact: true }).getByRole("button", { name: "Alpha", exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole("navigation", { name: "Notes", exact: true })
      .getByRole("button", { name: "Beta Updated", exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole("navigation", { name: "Notes", exact: true })
    .getByRole("button", { name: "Alpha", exact: true })
    .click()
  await page.getByRole("button", { name: "Write", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Markdown note editor" })
  await editor.fill("Edited, unsaved body")
  await page.getByRole("button", { name: "Calendar", exact: true }).click()
  await expect(page).toHaveURL(/\/notes/)
  await expect(editor).toHaveValue("Edited, unsaved body")
  await expect(page.getByRole("alert")).toContainText("Save or discard")
  await page.screenshot({ path: testInfo.outputPath("notes.png"), fullPage: true })
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(
    page.getByRole("navigation", { name: "Notes", exact: true }).getByRole("button", { name: "Alpha", exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText("No matching notes", { exact: true })).toBeVisible()
})

test("new note validation stays inside the narrow sidebar", async ({ page }, testInfo) => {
  await setup(page)
  await page.goto("/notes")
  await page
    .getByRole("region", { name: "Notes", exact: true })
    .getByRole("complementary")
    .getByRole("button", { name: "New note", exact: true })
    .click()
  await page.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Enter a note name")
  const title = page.getByRole("textbox", { name: "Note name" })
  await title.fill("Alpha")
  await page.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("already exists")
  const bounds = await title.boundingBox()
  const form = await page.locator("form").filter({ has: title }).boundingBox()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(form!.x + form!.width)
  await page.screenshot({ path: testInfo.outputPath("new-note.png"), fullPage: true })
})

test("Home opens the selected event, task and project; Today resets the displayed date", async ({ page }, testInfo) => {
  await setup(page)
  await page.goto("/")
  await page.getByRole("button", { name: /Audit Event/ }).click()
  await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue("Audit Event")
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page.getByRole("button", { name: /Audit Task/ }).click()
  await expect(page.getByRole("textbox", { name: "Task name" })).toHaveValue("Audit Task")
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await page.getByRole("button", { name: /^Audit Project/ }).click()
  await expect(page.getByText("An editable outcome", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Calendar", exact: true }).click()
  await page.getByRole("button", { name: "Month", exact: true }).click()
  await page.getByRole("button", { name: "Next month", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Calendar views" })
    .getByRole("button", { name: "Today", exact: true })
    .click()
  await expect(page.getByRole("button", { name: /Audit Event/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Previous day" })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("calendar.png"), fullPage: true })
})

test("an archived Project restores directly and map cards open its notes", async ({ page }, testInfo) => {
  await setup(page)
  await page.goto("/projects?project=project_audit")
  await page.getByRole("button", { name: "Archive Project", exact: true }).click()
  await page.getByRole("button", { name: /^Audit Project/ }).click()
  await page.getByRole("button", { name: "Restore Project", exact: true }).click()
  await expect(page.getByRole("button", { name: "Pause Project", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Map", exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath("project-map.png"), fullPage: true })
  await page.getByRole("button", { name: /Beta Updated/ }).click()
  await expect(page.getByRole("heading", { name: "Beta body" })).toBeVisible()
})

test("Spanish Brain navigation and harness names are localized", async ({ page }, testInfo) => {
  await setup(page, true)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Conocimiento", exact: true })).toBeVisible()
  await expect(page.getByRole("group", { name: "Motor de agente" })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("spanish-home.png"), fullPage: true })
})

test("settings switches have names and Escape cancels shortcut recording before closing settings", async ({
  page,
}, testInfo) => {
  await setup(page)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog).toBeVisible()
  const switches = dialog.getByRole("switch")
  expect(await switches.count()).toBeGreaterThan(0)
  for (const control of await switches.all()) await expect(control).toHaveAccessibleName(/.+/)
  await dialog.getByRole("tab", { name: "Shortcuts", exact: true }).click()
  await dialog.locator("[data-keybind-id]").first().click()
  await expect(dialog.locator(".settings-v2-keybind-button--active")).toHaveCount(1)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await expect(dialog.locator(".settings-v2-keybind-button--active")).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true })
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("blank server submission keeps its form and explains the missing address", async ({ page }, testInfo) => {
  await setup(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Servers", exact: true }).click()
  await page.getByRole("button", { name: "Add server", exact: true }).click()
  const address = page.getByRole("textbox", { name: "Server address", exact: true })
  await expect(address).toBeVisible()
  await address.fill("")
  await page.getByRole("button", { name: "Add server", exact: true }).click()
  await expect(address).toBeVisible()
  await expect(page.getByText("Server address: Required", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("server-validation.png"), fullPage: true })
})
