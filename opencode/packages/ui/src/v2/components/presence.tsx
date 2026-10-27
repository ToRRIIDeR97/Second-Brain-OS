import createPresence from "solid-presence"
import { type ParentProps, Show, createSignal } from "solid-js"

export interface PresenceProps extends ParentProps {
  when: boolean
  /** Animation class while shown. Default `animate-enter` (fade + 4px rise, medium, decelerate). */
  enterClass?: string
  /** Animation class while leaving. Default `animate-exit` (fade, short, accelerate). */
  exitClass?: string
  class?: string
}

/**
 * Mounts its children in a wrapper `div` while `when` is true and keeps them mounted until the exit
 * animation ends. The exit class must set a different `animation-name` from the enter class, or the
 * children unmount at once (as they do under reduced motion, where both default classes have no animation).
 */
export function Presence(props: PresenceProps) {
  const [ref, setRef] = createSignal<HTMLDivElement | null>(null)
  const presence = createPresence({ show: () => props.when, element: ref })

  return (
    <Show when={presence.present()}>
      <div
        ref={setRef}
        data-component="presence-v2"
        class={[props.class, props.when ? (props.enterClass ?? "animate-enter") : (props.exitClass ?? "animate-exit")]
          .filter(Boolean)
          .join(" ")}
      >
        {props.children}
      </div>
    </Show>
  )
}
