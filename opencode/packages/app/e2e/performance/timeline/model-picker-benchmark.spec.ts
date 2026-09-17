import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { fixture } from "./session-timeline-stress.fixture"
import { installStressSessionTabs, installTimelineSettings, stressDraftHref } from "./timeline-test-helpers"

benchmark("opens, searches, and selects from a large model catalog", async ({ page, report }) => {
  const providers = Array.from({ length: 180 }, (_, index) => {
    const id = `provider-${String(index).padStart(3, "0")}`
    return {
      id,
      name: id,
      models: Object.fromEntries(
        Array.from({ length: 8 }, (_, modelIndex) => {
          const modelID = `model-${String(index).padStart(3, "0")}-${modelIndex}`
          return [
            modelID,
            { id: modelID, providerID: id, name: modelID, release_date: "", limit: { context: 200_000 }, variants: {} },
          ]
        }),
      ),
    }
  })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    provider: {
      all: providers,
      connected: providers.map((provider) => provider.id),
      default: Object.fromEntries(providers.map((provider) => [provider.id, Object.keys(provider.models)[0]])),
    },
  })
  await installTimelineSettings(page)
  await installStressSessionTabs(page, { draftID: "model-picker", sessionIDs: [] })
  await page.goto(stressDraftHref("model-picker"))

  const trigger = page.locator('[data-action="prompt-model"]')
  await expect(trigger).toHaveText("model-000-0")
  const start = await page.evaluate(() => performance.now())
  await trigger.click()
  const search = page.getByPlaceholder("Search models")
  await expect(search).toBeFocused()
  const opened = await page.evaluate(() => performance.now())
  const options = await page.getByRole("menuitemradio").count()
  expect(options).toBeLessThan(1440)

  await page.getByRole("menuitemradio", { name: "model-000-1", exact: true }).hover()
  await expect(search).toBeFocused()
  const hovered = await page.evaluate(() => performance.now())
  await search.fill("model-179-7")
  await expect(page.getByRole("menuitemradio")).toHaveCount(1)
  await expect(page.getByRole("menuitemradio")).toHaveText("model-179-7")
  const searched = await page.evaluate(() => performance.now())

  await page.getByRole("menuitemradio", { name: "model-179-7", exact: true }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(trigger).toHaveText("model-179-7")
  const selected = await page.evaluate(() => performance.now())
  await trigger.click()
  await expect(search).toBeFocused()
  await expect(page.getByRole("menuitemradio", { name: "model-179-7", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  )
  await search.press("ArrowDown")
  await search.press("ArrowDown")
  await search.press("Enter")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(trigger).toHaveText("model-000-0")
  await trigger.click()
  await expect(search).toBeFocused()
  await search.fill("no-matching-model")
  await expect(page.getByRole("menuitemradio")).toHaveCount(0)
  await search.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(trigger).toHaveText("model-000-0")

  report(
    {
      openMs: opened - start,
      hoverMs: hovered - opened,
      searchMs: searched - hovered,
      selectMs: selected - searched,
      options,
    },
    { providers: 180, models: 1440 },
  )
})
