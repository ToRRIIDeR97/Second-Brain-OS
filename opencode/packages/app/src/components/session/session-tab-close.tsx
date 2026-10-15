import { Show } from "solid-js"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

/**
 * Close control for a pill tab. It sits inside the tab trigger, so it keeps the
 * trigger from selecting the tab and closes on Enter or Space itself.
 */
export function SessionTabClose(props: { label: string; keybind?: string[]; onClose: () => void }) {
  return (
    <TooltipV2
      value={
        <>
          {props.label}
          <Show when={props.keybind?.length}>
            <KeybindV2 keys={props.keybind!} variant="neutral" />
          </Show>
        </>
      }
      placement="bottom"
      gutter={10}
    >
      <TabsV2.CloseButton
        aria-label={props.label}
        onClick={() => props.onClose()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          event.stopPropagation()
          props.onClose()
        }}
      />
    </TooltipV2>
  )
}
