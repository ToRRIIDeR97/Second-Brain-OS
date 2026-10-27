import { afterEach, describe, expect, test } from "bun:test"
import { createReveal } from "@opencode-ai/ui/v2/reveal"
import { createViewSwitch } from "@opencode-ai/ui/v2/view-switch"
import { motionDuration, prefersReducedMotion } from "@opencode-ai/ui/v2/motion"
import { batch, createRoot, createSignal } from "solid-js"

// happy-dom answers `prefers-reduced-motion` from its device settings.
const device = () =>
  (window as unknown as { happyDOM: { settings: { device: { prefersReducedMotion: string } } } }).happyDOM.settings
    .device

afterEach(() => {
  device().prefersReducedMotion = "no-preference"
})

describe("motion tokens", () => {
  test("reads reduced motion and falls back to the token defaults", () => {
    expect(prefersReducedMotion()).toBe(false)
    device().prefersReducedMotion = "reduce"
    expect(prefersReducedMotion()).toBe(true)
    expect(motionDuration("short")).toBe(150)
    expect(motionDuration("medium")).toBe(300)
  })
})

describe("createReveal", () => {
  test("keeps children mounted while closing and unmounts once settled", () => {
    createRoot((dispose) => {
      const [open, setOpen] = createSignal(false)
      const reveal = createReveal(open)
      expect(reveal.mounted()).toBe(false)

      setOpen(true)
      expect(reveal.phase()).toBe("opening")
      expect(reveal.mounted()).toBe(true)
      reveal.settle()
      expect(reveal.phase()).toBe("open")

      setOpen(false)
      expect(reveal.phase()).toBe("closing")
      expect(reveal.mounted()).toBe(true)
      reveal.settle()
      expect(reveal.mounted()).toBe(false)
      dispose()
    })
  })

  test("reopening during the close keeps the children", () => {
    createRoot((dispose) => {
      const [open, setOpen] = createSignal(true)
      const reveal = createReveal(open)
      expect(reveal.phase()).toBe("open")
      setOpen(false)
      setOpen(true)
      expect(reveal.phase()).toBe("opening")
      reveal.settle()
      expect(reveal.mounted()).toBe(true)
      dispose()
    })
  })

  test("reduced motion opens and closes at once", () => {
    device().prefersReducedMotion = "reduce"
    createRoot((dispose) => {
      const [open, setOpen] = createSignal(true)
      const reveal = createReveal(open)
      setOpen(false)
      expect(reveal.mounted()).toBe(false)
      setOpen(true)
      expect(reveal.phase()).toBe("open")
      dispose()
    })
  })

  test("reports each finished open and close once, also from the fallback timer", async () => {
    const settled: string[] = []
    const { setOpen, dispose } = createRoot((dispose) => {
      const [open, setOpen] = createSignal(false)
      const reveal = createReveal(open, (phase) => settled.push(phase))
      return { setOpen, reveal, dispose }
    })
    setOpen(true)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(settled).toEqual(["open"])
    setOpen(false)
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(settled).toEqual(["open", "closed"])
    device().prefersReducedMotion = "reduce"
    setOpen(true)
    expect(settled).toEqual(["open", "closed", "open"])
    dispose()
  })
})

describe("createViewSwitch", () => {
  test("shows the outgoing view until it has faded out, then the incoming one", () => {
    createRoot((dispose) => {
      const [key, setKey] = createSignal("a")
      const [nodes, setNodes] = createSignal(["A"])
      const view = createViewSwitch(key, nodes)
      expect(view.phase()).toBe("idle")

      batch(() => {
        setKey("b")
        setNodes(["B"])
      })
      expect(view.phase()).toBe("out")
      expect(view.nodes()).toEqual(["A"])

      view.advance()
      expect(view.phase()).toBe("in")
      expect(view.nodes()).toEqual(["B"])

      view.advance()
      expect(view.phase()).toBe("idle")
      dispose()
    })
  })

  test("updates within one key do not fade", () => {
    createRoot((dispose) => {
      const [nodes, setNodes] = createSignal(["A"])
      const view = createViewSwitch(() => "a", nodes)
      setNodes(["A2"])
      expect(view.phase()).toBe("idle")
      expect(view.nodes()).toEqual(["A2"])
      dispose()
    })
  })

  test("reduced motion swaps at once", () => {
    device().prefersReducedMotion = "reduce"
    createRoot((dispose) => {
      const [key, setKey] = createSignal(1)
      const [nodes, setNodes] = createSignal(["one"])
      const view = createViewSwitch(key, nodes)
      batch(() => {
        setKey(2)
        setNodes(["two"])
      })
      expect(view.phase()).toBe("idle")
      expect(view.nodes()).toEqual(["two"])
      dispose()
    })
  })
})
