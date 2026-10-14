import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import type { Prompt } from "@/context/prompt"
import { Persist, persisted } from "@/utils/persist"
import { clonePromptParts } from "./history"

export const MAX_STASH = 20

/** A parked composer prompt: text, mentions, and image attachments (comment context stays in the composer). */
export type PromptStashEntry = { id: string; prompt: Prompt; time: number }

export type PromptStash = {
  entries: () => PromptStashEntry[]
  /** Returns false when the prompt is empty and nothing was stashed. */
  push: (prompt: Prompt) => boolean
  remove: (id: string) => void
  /** Removes and returns an entry for restoring into the composer. */
  take: (id: string) => PromptStashEntry | undefined
}

type PromptStashState = { entries: PromptStashEntry[] }

export function pushStashEntry(entries: PromptStashEntry[], entry: PromptStashEntry, max = MAX_STASH) {
  const text = entry.prompt
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
    .trim()
  if (!text && !entry.prompt.some((part) => part.type === "image")) return entries
  return [{ ...entry, prompt: clonePromptParts(entry.prompt) }, ...entries].slice(0, max)
}

export function createPromptStash(
  state: Store<PromptStashState>,
  setState: SetStoreFunction<PromptStashState>,
): PromptStash {
  const remove = (id: string) =>
    setState(
      "entries",
      state.entries.filter((entry) => entry.id !== id),
    )
  return {
    entries: () => state.entries,
    push(prompt) {
      const next = pushStashEntry(state.entries, { id: crypto.randomUUID(), prompt, time: Date.now() })
      if (next === state.entries) return false
      setState("entries", next)
      return true
    },
    remove,
    take(id) {
      const entry = state.entries.find((item) => item.id === id)
      if (!entry) return
      remove(id)
      return { ...entry, prompt: clonePromptParts(entry.prompt) }
    },
  }
}

export function createPersistedPromptStash() {
  const [state, setState] = persisted(
    Persist.prompt(Persist.global("prompt-stash")),
    createStore<PromptStashState>({ entries: [] }),
  )
  return createPromptStash(state, setState)
}
