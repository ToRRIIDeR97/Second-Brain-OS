export type ThreadMenuAction = "rename" | "pin" | "fork" | "archive" | "delete"

/** The single key each thread-menu item shows as its hint. */
export const THREAD_MENU_KEYS = { rename: "r", pin: "p", fork: "f", archive: "a", delete: "delete" } as const

const ACTION_BY_KEY: Partial<Record<string, ThreadMenuAction>> = {
  r: "rename",
  p: "pin",
  f: "fork",
  a: "archive",
  delete: "delete",
  backspace: "delete",
}

/**
 * The thread-menu item a key press runs while that menu has focus: R, P, F, A, or Delete/Backspace.
 * Presses with Ctrl, Alt or Meta, repeats, and IME composition run nothing.
 */
export function threadMenuAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "repeat" | "isComposing">,
) {
  const ignored = event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing
  return ignored ? undefined : ACTION_BY_KEY[event.key.toLowerCase()]
}
