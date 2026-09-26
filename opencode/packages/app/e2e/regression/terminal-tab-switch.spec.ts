import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalTabSwitch"
const projectID = "proj_terminal_tab_switch"
const sessionA = "ses_terminal_tab_a"
const sessionB = "ses_terminal_tab_b"
const titleA = "Alpha session"
const titleB = "Beta session"
const ptyID = "pty_tab_switch"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
// Marks the terminal DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

// Terminals are workspace-scoped: switching between session tabs in the same
// workspace must keep the terminal mounted and its PTY connection open instead
// of tearing it down and reconnecting.
for (const mixed of [true, false]) {
  test(`keeps the terminal alive across tabs on ${mixed ? "managed" : "current"} servers`, async ({
    page,
  }, testInfo) => {
    const connections = await setup(page, mixed)

    await page.goto(sessionHref(sessionA))
    await expectSessionTitle(page, titleA)

    const editor = page.locator('[data-component="prompt-input"][contenteditable="true"]')
    await expect(editor).toBeVisible()
    expect(await editor.evaluate((node) => getComputedStyle(node, "::before").content)).not.toContain("200B")
    await page.screenshot({ path: testInfo.outputPath("composer.png"), fullPage: true })
    await page.keyboard.press("Control+Backquote")
    const terminal = page.locator('[data-component="terminal"]')
    await expect(terminal).toBeVisible()
    await expect.poll(() => connections.length).toBe(1)
    const connection = new URL(connections[0]!)
    expect(connection.pathname).toBe(`${mixed ? "" : "/api"}/pty/${ptyID}/connect`)
    expect(connection.searchParams.get(mixed ? "directory" : "location[directory]")).toBe(directory)
    expect(connection.searchParams.get("ticket")).toBe("e2e-ticket")
    await expect(terminal.locator("canvas").first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("terminal.png"), fullPage: true })
    await writeProbe(page)

    await switchTab(page, titleB)
    await expectSessionTitle(page, titleB)
    await expect(terminal).toBeVisible()
    expect(await readProbe(page)).toBe(PROBE)
    expect(connections.length).toBe(1)

    await switchTab(page, titleA)
    await expectSessionTitle(page, titleA)
    await expect(terminal).toBeVisible()
    expect(await readProbe(page)).toBe(PROBE)
    expect(connections.length).toBe(1)
  })
}

type Probed = HTMLElement & { __e2eProbe?: string }

async function switchTab(page: Page, title: string) {
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
}

async function writeProbe(page: Page) {
  await page.locator('[data-component="terminal"]').evaluate((el, probe) => {
    ;(el as Probed).__e2eProbe = probe
  }, PROBE)
}

async function readProbe(page: Page) {
  return page.locator('[data-component="terminal"]').evaluate((el) => (el as Probed).__e2eProbe)
}

async function setup(page: Page, mixed = true) {
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "terminal-tab-switch",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [session(sessionA, titleA, 1700000000000), session(sessionB, titleB, 1700000001000)],
    pageMessages: () => ({ items: [] }),
  })
  if (mixed) {
    await page.route("**/api/health", (route) => route.fulfill({ json: { healthy: true } }))
    await page.route("**/global/health", (route) => route.fulfill({ json: { healthy: true, version: "dev" } }))
  }
  await page.route("**/api/pty*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
    }),
  )
  await page.route(`**/api/pty/${ptyID}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
    }),
  )
  await page.route(`**/${mixed ? "" : "api/"}pty/${ptyID}/connect-token*`, (route) => {
    expect(route.request().headers()["x-opencode-ticket"]).toBe("1")
    const url = new URL(route.request().url())
    expect(url.searchParams.get(mixed ? "directory" : "location[directory]")).toBe(directory)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(
        mixed
          ? { ticket: "e2e-ticket", expires_in: 60 }
          : { location: ptyLocation(), data: { ticket: "e2e-ticket", expires_in: 60 } },
      ),
    })
  })
  const connections: string[] = []
  await page.routeWebSocket(new RegExp(`/pty/${ptyID}/connect`), (ws) => {
    connections.push(ws.url())
    ws.send("Terminal connected\r\n")
  })

  await page.addInitScript(
    ({ directory, server, sessions }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((sessionId: string) => ({ type: "session", server, sessionId }))),
      )
    },
    { directory, server, sessions: [sessionA, sessionB] },
  )
  return connections
}

function session(id: string, title: string, created: number) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
  }
}

function sessionHref(sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

function ptyLocation() {
  return { directory, project: { id: projectID, directory } }
}

function ptyInfo() {
  return { id: ptyID, title: "Terminal 1", command: "cmd.exe", args: [], cwd: directory, status: "running", pid: 1 }
}

test("Codex exposes one effort selector and an independent service tier", async ({ page }, testInfo) => {
  await setup(page)
  await page.route("**/api/harness*", (route) =>
    route.fulfill({
      json: {
        location: ptyLocation(),
        data: [
          { id: "opencode", driver: "opencode", name: "OpenCode", status: "available", models: [] },
          {
            id: "codex",
            driver: "codex",
            name: "Codex",
            status: "available",
            models: [
              {
                id: "gpt-test",
                name: "GPT Test",
                isDefault: true,
                reasoningEfforts: ["low", "high"],
                serviceTiers: [{ id: "fast", name: "Fast" }],
                defaultReasoningEffort: "low",
              },
            ],
          },
        ],
      },
    }),
  )
  await page.goto(`/${base64Encode(directory)}/session`)
  await page.getByRole("button", { name: "Harness", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click()
  const effort = page.locator('[data-control="harness-effort"]')
  await expect(effort).toHaveCount(1)
  await expect(effort).toHaveText("low")
  await expect(page.locator('[data-control="harness-service-tier"]')).toHaveCount(1)
  await effort.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(effort).toHaveText("high")
  await page.screenshot({ path: testInfo.outputPath("codex-controls.png"), fullPage: true })
})

test("Last turn review displays native session snapshots", async ({ page }, testInfo) => {
  await setup(page)
  await page.route(`**/api/session/${sessionA}/message*`, (route) =>
    route.fulfill({
      json: {
        data: [{ id: "msg_native_review", type: "user", text: "Write a file", time: { created: 1700000000000 } }],
        cursor: {},
      },
    }),
  )
  await page.route(`**/api/session/${sessionA}/diff*`, (route) =>
    route.fulfill({
      json: {
        data: [
          {
            path: "agent-output.md",
            status: "added",
            additions: 1,
            deletions: 0,
            patch:
              "diff --git a/agent-output.md b/agent-output.md\nnew file mode 100644\n--- /dev/null\n+++ b/agent-output.md\n@@ -0,0 +1 @@\n+agent edit\n",
          },
        ],
      },
    }),
  )
  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await page.getByRole("button", { name: "Git changes", exact: true }).click()
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/session/${sessionA}/diff` && response.ok(),
  )
  await page.getByRole("option", { name: "Last turn changes", exact: true }).click()
  await response
  await expect(page.getByText("agent edit", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("last-turn.png"), fullPage: true })
})
