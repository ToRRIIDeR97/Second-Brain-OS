import { onMount } from "solid-js"

/**
 * For live lists whose rows `For` recreates on every rebuild: reports whether an id joined the list after
 * its first render, so only rows that appear later (a new thread, a run that started) animate in. Call it
 * once per row, as the row is created, inside the component that owns the list.
 */
export function createFreshItems() {
  const seen = new Set<string>()
  const ready = { current: false }
  onMount(() => (ready.current = true))
  return (id: string) => {
    const fresh = ready.current && !seen.has(id)
    seen.add(id)
    return fresh
  }
}
