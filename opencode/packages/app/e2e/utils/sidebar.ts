import { expect, type Page } from "@playwright/test"

/** Start with the sidebar's Brain and Other threads groups expanded so their threads are clickable. */
export async function expandSidebarThreadGroups(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "opencode.window.browser.dat:sidebar",
      JSON.stringify({ expanded: { __brain__: true, __other__: true } }),
    )
  })
}

/** Open a thread from the sidebar (client-side navigation, like a user click). */
export async function openSidebarThread(page: Page, sessionID: string) {
  const row = page.locator(`[data-sidebar-thread="${sessionID}"] [data-sidebar-thread-open]`)
  await expect(row).toBeVisible()
  await row.click()
}

/** Open the sidebar thread whose title contains `title`. */
export async function openSidebarThreadByTitle(page: Page, title: string) {
  const row = page.locator("[data-sidebar-thread-open]", { hasText: title })
  await expect(row).toBeVisible()
  await row.click()
}
