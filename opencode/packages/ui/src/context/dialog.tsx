import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
  startTransition,
  For,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"
import { motionDuration, prefersReducedMotion } from "../v2/components/motion"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
}

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  // A closing dialog waits out its exit animation before it is disposed and leaves the stack.
  const pending = {
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    finish: undefined as (() => void) | undefined,
  }
  const lock = { value: false }

  onCleanup(() => {
    clearTimeout(pending.timer)
    pending.timer = undefined
    pending.finish = undefined
  })

  // Finishes a pending close now, so a dialog opened during another's exit stacks above a settled list.
  const settle = () => {
    const finish = pending.finish
    clearTimeout(pending.timer)
    pending.timer = undefined
    pending.finish = undefined
    finish?.()
  }

  const close = (id?: string) => {
    const items = stack()
    const current = id ? items.find((item) => item.id === id) : items.at(-1)
    if (!current || lock.value) return false
    lock.value = true
    current.onClose?.()
    current.setClosing(true)

    settle()
    pending.finish = () => {
      current.dispose()
      setStack((items) => items.filter((item) => item.id !== current.id))
      lock.value = false
    }
    pending.timer = setTimeout(settle, exitDelay())
    return true
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // Something that used the Escape (a nested menu or select closing) keeps the dialog open. A Kobalte
      // tab list prevents every Escape without using it, so focus on a tab still closes the dialog.
      if (event.defaultPrevented && !fromTabList(event)) return
      if (!close()) return
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown)
  })

  const mount = (element: DialogElement, owner: Owner, onClose: (() => void) | undefined, layer: number) => {
    const id = Math.random().toString(36).slice(2)
    const zIndex = 50 + layer * 10
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        return (
          <Kobalte
            modal
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (open) return
              close(id)
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": String(zIndex) }}
                onClick={() => close(id)}
              />
              <div
                data-dialog-layer={layer}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": String(zIndex),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "pointer-events": "none",
                }}
              >
                {element()}
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return

    const active: Active = { id, node, dispose, owner, onClose, setClosing }
    setStack((items) => [...items, active])
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    settle()
    lock.value = false
    mount(element, owner, onClose, stack().length)
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    settle()
    for (const item of stack()) item.dispose()
    setStack([])
    lock.value = false
    mount(element, owner, onClose, 0)
  }

  return {
    stack,
    close,
    show,
    push,
  }
}

// The overlay and dialog exits run for --v2-duration-short (dialog-v2.css); dispose one frame after them so
// the root is not torn down mid-animation. Reduced motion has no exit, so dispose at once.
function exitDelay() {
  if (prefersReducedMotion()) return 0
  return motionDuration("short") + 16
}

// Kobalte's selectable collection calls preventDefault on Escape for a tab list, where it has nothing to clear.
function fromTabList(event: KeyboardEvent) {
  return event.target instanceof Element && event.target.closest('[role="tablist"]') !== null
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack()}>{(item) => item.node}</For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()

  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.stack().at(-1)
    },
    show(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.show(element, base, onClose))
    },
    push(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.push(element, base, onClose))
    },
    close() {
      ctx.close()
    },
  }
}
