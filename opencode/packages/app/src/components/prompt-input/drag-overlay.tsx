import { Component, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

type PromptDragOverlayProps = {
  type: "image" | "@mention" | null
  label: string
}

const kindToIcon = {
  image: "photo",
  "@mention": "link",
} as const

export const PromptDragOverlay: Component<PromptDragOverlayProps> = (props) => {
  return (
    <Show when={props.type !== null}>
      <div class="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-v2-background-bg-accent-container/90 pointer-events-none animate-in fade-in duration-150 motion-reduce:animate-none">
        <div class="flex flex-col items-center gap-2 text-v2-text-text-on-accent-container">
          <Icon name={props.type ? kindToIcon[props.type] : kindToIcon.image} class="size-8" />
          <span class="text-[13px] [font-weight:530]">{props.label}</span>
        </div>
      </div>
    </Show>
  )
}
