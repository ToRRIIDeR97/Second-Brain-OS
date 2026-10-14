import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { Prompt } from "@/context/prompt"
import { MAX_STASH, createPromptStash, pushStashEntry, type PromptStashEntry } from "./stash-store"

const text = (value: string): Prompt => [{ type: "text", content: value, start: 0, end: value.length }]

function stash() {
  const [state, setState] = createStore<{ entries: PromptStashEntry[] }>({ entries: [] })
  return createPromptStash(state, setState)
}

describe("prompt stash", () => {
  test("keeps the newest entry first and skips blank prompts", () => {
    const store = stash()
    expect(store.push(text("  "))).toBe(false)
    expect(store.push(text("first"))).toBe(true)
    expect(store.push(text("second"))).toBe(true)

    expect(store.entries().map((entry) => entry.prompt[0])).toMatchObject([{ content: "second" }, { content: "first" }])
  })

  test("keeps image-only prompts", () => {
    const image = {
      type: "image",
      id: "img",
      filename: "a.png",
      mime: "image/png",
      dataUrl: "data:image/png;base64,AA==",
    } as unknown as Prompt[number]
    expect(pushStashEntry([], { id: "a", prompt: [image], time: 1 })).toHaveLength(1)
  })

  test("caps the stash at twenty entries", () => {
    const entries = Array.from({ length: MAX_STASH + 5 }).reduce<PromptStashEntry[]>(
      (list, _, index) => pushStashEntry(list, { id: `${index}`, prompt: text(`p${index}`), time: index }),
      [],
    )

    expect(entries).toHaveLength(MAX_STASH)
    expect(entries[0]?.id).toBe(`${MAX_STASH + 4}`)
  })

  test("take removes and returns a copy; remove deletes", () => {
    const store = stash()
    store.push(text("keep"))
    store.push(text("restore"))
    const [restore, keep] = store.entries()

    const taken = store.take(restore!.id)
    expect(taken?.prompt).toMatchObject([{ content: "restore" }])
    expect(store.entries().map((entry) => entry.id)).toEqual([keep!.id])
    expect(store.take("missing")).toBeUndefined()

    store.remove(keep!.id)
    expect(store.entries()).toEqual([])
  })
})
