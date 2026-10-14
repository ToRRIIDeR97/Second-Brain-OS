/**
 * Undoable actions shown as short-lived toasts.
 *
 * An action has already happened (archive, rename) or is deferred (delete).
 * Within `duration` the user can undo it from the toast or with `undoLatest()`.
 * When the window closes, `commit` runs; deferred actions do their real work there.
 * Nothing is persisted: if the app closes first, pending commits never run.
 */
export type UndoAction = {
  title: string
  description?: string
  undo: () => unknown
  commit?: () => unknown
}

export type UndoQueueOptions = {
  duration?: number
  /** Show the toast and return its id. `undo` runs the action's undo and settles it. */
  show: (action: UndoAction, undo: () => void) => number
  dismiss: (toastId: number) => void
  onChange?: (pending: number) => void
  onError?: (cause: unknown) => void
  /** Run `run` after `ms`; returns a cancel function. */
  schedule?: (run: () => void, ms: number) => () => void
}

export const UNDO_DURATION = 5_000

type Entry = { action: UndoAction; toastId: number; cancel: () => void }

export function createUndoQueue(options: UndoQueueOptions) {
  const duration = options.duration ?? UNDO_DURATION
  const schedule =
    options.schedule ??
    ((run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    })
  const entries: Entry[] = []

  const run = (fn: (() => unknown) | undefined) => {
    if (!fn) return
    try {
      void Promise.resolve(fn()).catch((cause) => options.onError?.(cause))
    } catch (cause) {
      options.onError?.(cause)
    }
  }

  const settle = (entry: Entry, mode: "undo" | "commit") => {
    const index = entries.indexOf(entry)
    if (index === -1) return false
    entries.splice(index, 1)
    entry.cancel()
    options.dismiss(entry.toastId)
    options.onChange?.(entries.length)
    run(mode === "undo" ? entry.action.undo : entry.action.commit)
    return true
  }

  return {
    push(action: UndoAction) {
      const entry: Entry = { action, toastId: 0, cancel: () => {} }
      entries.push(entry)
      entry.toastId = options.show(action, () => settle(entry, "undo"))
      entry.cancel = schedule(() => settle(entry, "commit"), duration)
      options.onChange?.(entries.length)
    },
    /** Undo the most recent pending action. Returns false when nothing is pending. */
    undoLatest() {
      const entry = entries.at(-1)
      return entry ? settle(entry, "undo") : false
    },
    /** Commit every pending action now (e.g. on teardown). */
    flush() {
      while (entries[0]) settle(entries[0], "commit")
    },
    pending: () => entries.length,
  }
}

export type UndoQueue = ReturnType<typeof createUndoQueue>
