import { expect, test } from "bun:test"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { createRoot, createSignal } from "solid-js"

test("snaps spring progress when the session changes", async () => {
  const state = createRoot((dispose) => {
    const [target, setTarget] = createSignal(0)
    const [session, setSession] = createSignal("session-a")
    const progress = useSpring(target, { visualDuration: 0.3, bounce: 0 }, session)
    return { dispose, progress, setTarget, setSession }
  })

  await new Promise<void>(queueMicrotask)
  state.setTarget(1)
  expect(state.progress()).toBe(0)

  state.setSession("session-b")
  expect(state.progress()).toBe(1)
  state.dispose()
})

test("jumps to the target under reduced motion", () => {
  const device = (window as unknown as { happyDOM: { settings: { device: { prefersReducedMotion: string } } } })
    .happyDOM.settings.device
  device.prefersReducedMotion = "reduce"
  const state = createRoot((dispose) => {
    const [target, setTarget] = createSignal(0)
    const progress = useSpring(target, { visualDuration: 0.3, bounce: 0 })
    return { dispose, progress, setTarget }
  })

  state.setTarget(1)
  expect(state.progress()).toBe(1)
  state.dispose()
  device.prefersReducedMotion = "no-preference"
})
