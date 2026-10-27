import { Presence } from "@opencode-ai/ui/v2/presence"
import { prefersReducedMotion } from "@opencode-ai/ui/v2/motion"
import { createEffect, createMemo, on, untrack, type JSX, type ParentProps } from "solid-js"
import { replayAnimation } from "@/utils/replay-animation"

/**
 * The Calendar and Tasks layout: the main view and, at lg widths, a 340px side panel column. The column
 * eases open (medium + emphasized-decelerate) and shut (short + emphasized-accelerate) with the panel.
 */
export const sidePanelGridClass = (open: boolean) =>
  open
    ? "grid flex-1 items-start gap-y-3 px-3 pb-3 transition-[grid-template-columns,column-gap] duration-medium ease-emphasized-decelerate motion-reduce:transition-none lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-3"
    : "grid flex-1 items-start gap-y-3 px-3 pb-3 transition-[grid-template-columns,column-gap] duration-short ease-emphasized-accelerate motion-reduce:transition-none lg:grid-cols-[minmax(0,1fr)_0px] lg:gap-x-0"

/**
 * The side panel of `sidePanelGridClass`. It fades in and out with its column, and while closing it shows
 * the content it last rendered (no longer reactive), so it never empties before it has gone. A change of
 * `view` while open (peek to editor, one event to another) fades the new content in.
 */
export function SidePanel(props: ParentProps<{ open: boolean; view?: string; ref?: (element: HTMLElement) => void }>) {
  const open = createMemo(() => props.open)
  const panel = { aside: undefined as HTMLElement | undefined }
  const live = createMemo(() =>
    open()
      ? untrack(() => (
          <aside
            ref={(element) => {
              panel.aside = element
              props.ref?.(element)
            }}
            class="flex max-h-[calc(100dvh-8rem)] flex-col overflow-y-auto rounded-[24px] bg-v2-background-bg-layer-01 lg:w-[340px]"
          >
            {props.children}
          </aside>
        ))
      : undefined,
  )
  const shown = createMemo<JSX.Element>((previous) => live() ?? previous)

  createEffect(
    on(
      () => (open() ? props.view : undefined),
      (view, previous) => {
        if (view !== undefined && previous !== undefined) replayAnimation(panel.aside)
      },
      { defer: true },
    ),
  )

  return (
    <Presence when={open()} class="min-w-0 overflow-hidden lg:sticky lg:top-3">
      {shown()}
    </Presence>
  )
}

/** Below the two-column layout the panel opens under the main view; bring it into view. */
export function revealSidePanel(element: HTMLElement) {
  queueMicrotask(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) return
    element.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" })
  })
}
