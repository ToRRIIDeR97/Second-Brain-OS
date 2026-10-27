/**
 * For live lists whose rows `For` recreates on every rebuild: reports whether an id joined the list after
 * its first non-empty render, so only rows that appear later (a new thread, a run that started) animate
 * in. Lists often mount empty and fill when their query resolves; the rows of that first fill, created in
 * one synchronous render, all count as seen. Call it once per row, as the row is created.
 */
export function createFreshItems() {
  const seen = new Set<string>()
  const state = { ready: false, arming: false }
  return (id: string) => {
    const fresh = state.ready && !seen.has(id)
    seen.add(id)
    if (!state.ready && !state.arming) {
      state.arming = true
      queueMicrotask(() => (state.ready = true))
    }
    return fresh
  }
}
