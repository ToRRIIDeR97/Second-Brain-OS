import { createRoot, type Owner } from "solid-js"

type Entry = {
  value: unknown
  dispose: VoidFunction
}

/**
 * Keeps reactive state (for example prompt sessions) alive across route remounts.
 * Keys are evicted least-recently-used first once `limit` keys are held; evicted
 * state is rebuilt from its persisted copy on next use.
 */
export function createStateMemory(owner: Owner | null, limit = Number.POSITIVE_INFINITY) {
  const entries = new Map<string, Map<string, Entry>>()

  const remove = (key: string) => {
    const state = entries.get(key)
    if (!state) return
    for (const entry of state.values()) entry.dispose()
    entries.delete(key)
  }

  const touch = (key: string, state: Map<string, Entry>) => {
    entries.delete(key)
    entries.set(key, state)
    while (entries.size > limit) {
      const oldest = entries.keys().next().value
      if (oldest === undefined || oldest === key) return
      remove(oldest)
    }
  }

  return {
    get<T>(key: string, name: string) {
      return entries.get(key)?.get(name)?.value as T | undefined
    },
    ensure<T>(key: string, name: string, init: () => T) {
      const state = entries.get(key) ?? new Map<string, Entry>()
      touch(key, state)
      const existing = state.get(name)
      if (existing) return existing.value as T
      const entry = createRoot((dispose) => ({ value: init(), dispose }), owner)
      state.set(name, entry)
      return entry.value
    },
    remove,
    dispose() {
      for (const key of Array.from(entries.keys())) remove(key)
    },
  }
}
