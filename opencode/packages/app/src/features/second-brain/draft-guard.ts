import { useBeforeLeave } from "@solidjs/router"
import { onCleanup } from "solid-js"

export function useDraftGuard(dirty: () => boolean, blocked: () => void) {
  useBeforeLeave((event) => {
    if (!dirty()) return
    event.preventDefault()
    blocked()
  })
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty()) return
    event.preventDefault()
    event.returnValue = ""
  }
  window.addEventListener("beforeunload", beforeUnload)
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload))
}
