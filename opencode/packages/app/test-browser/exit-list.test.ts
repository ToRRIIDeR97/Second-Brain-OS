import { afterEach, describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createExitList } from "../src/pages/session/composer/exit-list"

const device = () =>
  (window as unknown as { happyDOM: { settings: { device: { prefersReducedMotion: string } } } }).happyDOM.settings
    .device

afterEach(() => {
  device().prefersReducedMotion = "no-preference"
})

type Item = { id: string; text: string }
const item = (id: string): Item => ({ id, text: id })
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const view = (entries: { key: string; open: boolean }[]) => entries.map((entry) => `${entry.key}:${entry.open}`)

describe("createExitList", () => {
  test("first items show open; later ones open a frame after they arrive", async () => {
    const { list, setItems, dispose } = createRoot((dispose) => {
      const [items, setItems] = createSignal([item("a")])
      return { list: createExitList(items, (entry) => entry.id), setItems, dispose }
    })
    expect(view(list())).toEqual(["a:true"])
    setItems([item("a"), item("b")])
    expect(view(list())).toEqual(["a:true", "b:false"])
    await frame()
    expect(view(list())).toEqual(["a:true", "b:true"])
    dispose()
  })

  test("a removed item stays closed in place until its exit has played", async () => {
    const { list, setItems, dispose } = createRoot((dispose) => {
      const [items, setItems] = createSignal([item("a"), item("b"), item("c")])
      return { list: createExitList(items, (entry) => entry.id), setItems, dispose }
    })
    setItems([item("a"), item("c")])
    expect(view(list())).toEqual(["a:true", "b:false", "c:true"])
    expect(list()[1]?.item.text).toBe("b")
    await wait(250)
    expect(view(list())).toEqual(["a:true", "c:true"])
    dispose()
  })

  test("an item that comes back while leaving reopens and is kept", async () => {
    const { list, setItems, dispose } = createRoot((dispose) => {
      const [items, setItems] = createSignal([item("a"), item("b")])
      return { list: createExitList(items, (entry) => entry.id), setItems, dispose }
    })
    setItems([item("a")])
    setItems([item("a"), item("b")])
    expect(view(list())).toEqual(["a:true", "b:true"])
    await wait(250)
    expect(view(list())).toEqual(["a:true", "b:true"])
    dispose()
  })

  test("reduced motion adds and removes at once", () => {
    device().prefersReducedMotion = "reduce"
    const { list, setItems, dispose } = createRoot((dispose) => {
      const [items, setItems] = createSignal([item("a")])
      return { list: createExitList(items, (entry) => entry.id), setItems, dispose }
    })
    setItems([item("b")])
    expect(view(list())).toEqual(["b:true"])
    dispose()
  })
})
