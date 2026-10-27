import type { ParentProps } from "solid-js"
import { Accordion } from "@opencode-ai/ui/accordion"
import { Reveal } from "@opencode-ai/ui/v2/reveal"

/**
 * Accordion content that opens and closes through Reveal (grid rows, motion tokens) instead of Kobalte's
 * measured-height keyframes, which measure deferred or late-rendering diffs before they have a height. The
 * item must be `forceMount`ed; Reveal unmounts the content once closed. `onClosed` runs when the close has
 * finished, so a deferred body can drop its render then rather than vanish while it closes.
 */
export function AccordionReveal(props: ParentProps<{ open: boolean; onClosed?: () => void }>) {
  return (
    <Reveal
      open={props.open}
      onSettled={(phase) => {
        if (phase === "closed") props.onClosed?.()
      }}
    >
      <Accordion.Content>{props.children}</Accordion.Content>
    </Reveal>
  )
}
