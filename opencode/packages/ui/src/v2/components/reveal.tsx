import { type Accessor, type ParentProps, Show, createComputed, createSignal, on, onCleanup, untrack } from "solid-js"
import { motionDuration, prefersReducedMotion } from "./motion"
import "./reveal-v2.css"

export interface RevealProps extends ParentProps {
  open: boolean
  class?: string
  onTransitionEnd?: (event: TransitionEvent) => void
  /** Runs when an open or a close has finished, from `transitionend` or the fallback timer (once per phase). */
  onSettled?: (phase: "open" | "closed") => void
}

/**
 * Expands and collapses its children (grid rows 0fr to 1fr, with opacity). Opening uses medium +
 * emphasized-decelerate, closing short + emphasized-accelerate. Children stay mounted while closing and
 * unmount once closed; reduced motion opens and closes at once. The grid and its clip apply only while
 * moving (`data-phase` opening or closing): settled open, the wrapper is a plain block, so it adds no grid
 * layout to every reflow; closed, it is `display: none` and empty.
 */
export function Reveal(props: RevealProps) {
  const reveal = createReveal(
    () => props.open,
    (phase) => props.onSettled?.(phase),
  )

  return (
    <div
      data-component="reveal-v2"
      data-open={props.open ? "" : undefined}
      data-phase={reveal.phase()}
      class={props.class}
      inert={props.open ? undefined : true}
      aria-hidden={props.open ? undefined : "true"}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) reveal.settle()
        props.onTransitionEnd?.(event)
      }}
    >
      <div data-slot="reveal-v2-content">
        <Show when={reveal.mounted()}>{props.children}</Show>
      </div>
    </div>
  )
}

export type RevealPhase = "closed" | "opening" | "open" | "closing"

/**
 * Reveal's phase machine, separate from the DOM so it can be tested. `settle` ends a running phase; the
 * component calls it on `transitionend`, and a timer calls it when no transition event arrives (hidden
 * element, interrupted style change). `onSettled` hears each finished open or close, including the
 * immediate ones under reduced motion.
 */
export function createReveal(open: Accessor<boolean>, onSettled?: (phase: "open" | "closed") => void) {
  const [phase, setPhase] = createSignal<RevealPhase>(open() ? "open" : "closed")
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  const settle = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    const current = untrack(phase)
    if (current !== "opening" && current !== "closing") return
    const next = current === "opening" ? "open" : "closed"
    setPhase(next)
    onSettled?.(next)
  }

  createComputed(
    on(
      open,
      (next) => {
        clearTimeout(timer.current)
        if (prefersReducedMotion()) {
          setPhase(next ? "open" : "closed")
          onSettled?.(next ? "open" : "closed")
          return
        }
        setPhase(next ? "opening" : "closing")
        timer.current = setTimeout(settle, motionDuration(next ? "medium" : "short") + 50)
      },
      { defer: true },
    ),
  )

  onCleanup(() => clearTimeout(timer.current))

  return {
    phase,
    mounted: () => phase() !== "closed",
    settle,
  }
}
