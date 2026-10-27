import { prefersReducedMotion } from "@opencode-ai/ui/v2/motion"

/**
 * Plays a CSS animation class (default `animate-enter`) on an element that stays mounted, such as a panel
 * whose view changed. Set the element's other classes with `classList`, not a reactive `class` string,
 * which would drop the added class. Does nothing under reduced motion.
 */
export function replayAnimation(element: HTMLElement | undefined, className = "animate-enter") {
  if (!element || prefersReducedMotion()) return
  element.classList.remove(className)
  void element.offsetWidth
  element.classList.add(className)
}
