// Shared runtime reads of the Material 3 motion tokens in v2/styles/theme.css, for JS that has to time
// work against a CSS animation (dispose after an exit, fall back when an animation event never fires).

const FALLBACK = { short: 150, medium: 300, long: 450 }

export type MotionDuration = keyof typeof FALLBACK

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

/** `--v2-duration-<name>` in milliseconds, read from `element` (default: the root element). */
export function motionDuration(name: MotionDuration, element?: Element) {
  if (typeof document === "undefined") return FALLBACK[name]
  const value = parseFloat(
    getComputedStyle(element ?? document.documentElement).getPropertyValue(`--v2-duration-${name}`),
  )
  return Number.isFinite(value) ? value : FALLBACK[name]
}
