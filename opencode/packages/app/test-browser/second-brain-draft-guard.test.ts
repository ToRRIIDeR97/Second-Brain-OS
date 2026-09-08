import { expect, test } from "bun:test"
import { MemoryRouter, Route, useNavigate } from "@solidjs/router"
import { createSignal } from "solid-js"
import { createComponent, render } from "solid-js/web"
import { useDraftGuard } from "../src/features/second-brain/draft-guard"

test("blocks router navigation and unload while dirty, then releases after save and cleanup", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const [dirty, setDirty] = createSignal(true)
  let blocked = 0
  const Editor = () => {
    const navigate = useNavigate()
    useDraftGuard(dirty, () => blocked++)
    const link = document.createElement("button")
    link.textContent = "Leave editor"
    link.onclick = () => navigate("/elsewhere")
    return link
  }
  const dispose = render(
    () =>
      createComponent(MemoryRouter, {
        get children() {
          return [
            createComponent(Route, { path: "/", component: Editor }),
            createComponent(Route, { path: "/elsewhere", component: () => "Elsewhere" }),
          ]
        },
      }),
    host,
  )
  try {
    host.querySelector("button")!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(blocked).toBe(1)
    expect(host.textContent).toBe("Leave editor")
    const unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    setDirty(false)
    host.querySelector("button")!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(host.textContent).toBe("Elsewhere")
    setDirty(true)
    const after = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  } finally {
    dispose()
    host.remove()
  }
})
