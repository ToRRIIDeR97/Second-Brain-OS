/**
 * Focuses a field rendered after the page loaded (Solid's `autofocus` does not). A view that fades in
 * through `ViewSwitch` is attached a moment after it renders, so this waits up to `frames` animation
 * frames for the element to join the document. It does not scroll by default: a field inside an opening
 * `Reveal` sits in clipped content, which a focus scroll would shift.
 */
export function focusWhenConnected(element: HTMLElement, options: FocusOptions = { preventScroll: true }, frames = 30) {
  const attempt = (left: number) => {
    if (element.isConnected) {
      element.focus(options)
      return
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1))
  }
  queueMicrotask(() => attempt(frames))
}
