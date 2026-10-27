import { type Accessor, createComputed, onCleanup, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { motionDuration, prefersReducedMotion } from "@opencode-ai/ui/v2/motion"

export type ExitListEntry<T> = { key: string; item: T; open: boolean }

/**
 * A list for rows that animate in and out (each row a Reveal driven by `open`). Items added after the first
 * read start closed and open a frame later; removed items stay, closed, at the place they left until the
 * short exit has played. Reduced motion adds and removes at once.
 */
export function createExitList<T>(items: Accessor<readonly T[]>, key: (item: T) => string) {
  const [store, setStore] = createStore({ entries: [] as ExitListEntry<T>[] })
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const entering = new Set<string>()
  const state = { first: true, frame: undefined as number | undefined }

  const remove = (k: string) => {
    timers.delete(k)
    setStore("entries", (list) => list.filter((entry) => entry.key !== k || entry.open))
  }

  const openEntering = () => {
    state.frame = undefined
    entering.forEach((k) => {
      const index = store.entries.findIndex((entry) => entry.key === k)
      if (index >= 0) setStore("entries", index, "open", true)
    })
    entering.clear()
  }

  createComputed(() => {
    const next = items()
    untrack(() => {
      const still = state.first || prefersReducedMotion()
      state.first = false
      const previous = new Set(store.entries.map((entry) => entry.key))
      const entries: ExitListEntry<T>[] = next.map((item) => {
        const k = key(item)
        clearTimeout(timers.get(k))
        timers.delete(k)
        if (previous.has(k)) return { key: k, item, open: !entering.has(k) }
        if (!still) entering.add(k)
        return { key: k, item, open: still }
      })
      const listed = new Set(entries.map((entry) => entry.key))
      if (!still)
        store.entries.forEach((entry, index) => {
          if (listed.has(entry.key)) return
          entering.delete(entry.key)
          // A leaving row stays right after the nearest earlier row that is still listed.
          const before = store.entries.slice(0, index).findLast((other) => listed.has(other.key))
          const at = before ? entries.findIndex((other) => other.key === before.key) + 1 : 0
          entries.splice(at, 0, { key: entry.key, item: entry.item, open: false })
          listed.add(entry.key)
          if (!timers.has(entry.key))
            timers.set(
              entry.key,
              setTimeout(() => remove(entry.key), motionDuration("short") + 50),
            )
        })
      setStore("entries", reconcile(entries, { key: "key" }))
      if (entering.size > 0 && state.frame === undefined) state.frame = requestAnimationFrame(openEntering)
    })
  })

  onCleanup(() => {
    timers.forEach((timer) => clearTimeout(timer))
    if (state.frame !== undefined) cancelAnimationFrame(state.frame)
  })

  return () => store.entries
}
