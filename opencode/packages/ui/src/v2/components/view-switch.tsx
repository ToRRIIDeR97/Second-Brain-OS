import {
  type Accessor,
  type JSX,
  type ParentProps,
  children,
  createComputed,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { motionDuration, prefersReducedMotion } from "./motion"
import "./view-switch-v2.css"

export interface ViewSwitchProps extends ParentProps {
  /** Identity of the current view. A change plays the fade-through; content updates within one key do not. */
  key: string | number | undefined
  class?: string
}

/**
 * Fade-through between views: when `key` changes, the outgoing view fades out (short +
 * emphasized-accelerate), then the incoming view fades in (medium + emphasized-decelerate). Only one view is
 * rendered at a time, so the layout never holds both. Reduced motion swaps at once.
 *
 * The outgoing view is kept as the DOM it last rendered, so it works best when each key renders its own
 * branch (`Switch`/`Match`, `Dynamic`, a keyed `Show`). While it fades out it is `inert` and `aria-hidden`,
 * so clicks and keys cannot reach it; if it held focus, focus moves into the incoming view once attached,
 * unless the caller has already placed it.
 */
export function ViewSwitch(props: ViewSwitchProps) {
  const resolved = children(() => props.children)
  const view = createViewSwitch(
    () => props.key,
    () => resolved.toArray(),
  )
  const [ref, setRef] = createSignal<HTMLDivElement>()
  const focus = { restore: false }

  // Runs before the render effect that sets `inert`, which would blur the focused element.
  createComputed(
    on(view.phase, (phase) => {
      if (phase !== "out") return
      focus.restore = !!ref()?.contains(document.activeElement)
    }),
  )

  // Effects run after the incoming nodes are inserted.
  createEffect(
    on(view.phase, (phase) => {
      if (phase === "out" || !focus.restore) return
      focus.restore = false
      const element = ref()
      const active = document.activeElement
      if (!element || element.contains(active) || (active && active !== document.body)) return
      const target = element.querySelector<HTMLElement>("[autofocus]") ?? element.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus({ preventScroll: true })
    }),
  )

  return (
    <div
      ref={setRef}
      data-component="view-switch-v2"
      data-phase={view.phase()}
      inert={view.phase() === "out" ? true : undefined}
      aria-hidden={view.phase() === "out" ? "true" : undefined}
      class={props.class}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) view.advance()
      }}
    >
      {view.nodes()}
    </div>
  )
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type ViewSwitchPhase = "idle" | "out" | "in"

/**
 * ViewSwitch's phase machine, separate from the DOM so it can be tested. `advance` ends the running phase;
 * the component calls it on `animationend`, and a timer calls it when no animation event arrives.
 */
export function createViewSwitch<K>(key: Accessor<K>, nodes: Accessor<JSX.Element[]>) {
  const [phase, setPhase] = createSignal<ViewSwitchPhase>("idle")
  const [frozen, setFrozen] = createSignal<JSX.Element[]>()
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }
  const last = { key: untrack(key), nodes: untrack(nodes) }

  const schedule = (ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(advance, ms + 50)
  }

  const advance = () => {
    const current = untrack(phase)
    if (current === "out") {
      setFrozen(undefined)
      setPhase("in")
      schedule(motionDuration("medium"))
      return
    }
    clearTimeout(timer.current)
    timer.current = undefined
    setPhase("idle")
  }

  createComputed(() => {
    const next = { key: key(), nodes: nodes() }
    const previous = { ...last }
    last.key = next.key
    last.nodes = next.nodes
    if (next.key === previous.key) return
    untrack(() => {
      if (prefersReducedMotion()) {
        clearTimeout(timer.current)
        timer.current = undefined
        setFrozen(undefined)
        setPhase("idle")
        return
      }
      // A key change during the fade-out keeps the view that was on screen when it started.
      if (phase() === "out") return
      setFrozen(() => previous.nodes)
      setPhase("out")
      schedule(motionDuration("short"))
    })
  })

  onCleanup(() => clearTimeout(timer.current))

  return {
    phase,
    nodes: () => frozen() ?? nodes(),
    advance,
  }
}
