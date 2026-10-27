import { createContext, useContext, type ParentProps } from "solid-js"
import type { Design } from "../components/design-fence"

/** What the app does with a design window's buttons; each action is optional so a surface can omit it. */
export type DesignSpace = {
  /** "Use this one": reference the design in the composer. */
  use?: (design: Design) => void
  /** "Open in canvas": add the design to the Canvas tab and show it there. */
  open?: (design: Design) => void
  /** A canvas block finished streaming in this view. */
  reveal?: (design: Design) => void
}

const Context = createContext<DesignSpace>()

export function DesignSpaceProvider(props: ParentProps<DesignSpace>) {
  // Getters so the app can offer an action only where it works (for example the Canvas tab on desktop).
  const value: DesignSpace = {
    get use() {
      return props.use
    },
    get open() {
      return props.open
    },
    get reveal() {
      return props.reveal
    },
  }
  return <Context.Provider value={value}>{props.children}</Context.Provider>
}

/** Undefined outside a provider: design windows then show no action buttons. */
export function useDesignSpace() {
  return useContext(Context)
}
