import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useSortable } from "@dnd-kit/solid/sortable"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { FileVisual } from "./session-sortable-tab"
import { SessionTabClose } from "./session-tab-close"

export function SortableTabV2(props: {
  tab: string
  index: () => number
  temporary?: boolean
  onTabClose: (tab: string) => void
  onTabDoubleClick?: (tab: string) => void
}): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sortable = useSortable({
    get id() {
      return props.tab
    },
    get index() {
      return props.index()
    },
  })
  const path = createMemo(() => file.pathFromTab(props.tab))
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} temporary={props.temporary} />
  })
  return (
    <div ref={sortable.ref} class="h-full flex items-center">
      <TabsV2.Trigger
        value={props.tab}
        onMiddleClick={() => props.onTabClose(props.tab)}
        onDblClick={() => props.onTabDoubleClick?.(props.tab)}
      >
        <Show when={content()}>{(value) => value()}</Show>
        <SessionTabClose
          label={language.t("common.closeTab")}
          keybind={command.keybindParts("tab.close")}
          onClose={() => props.onTabClose(props.tab)}
        />
      </TabsV2.Trigger>
    </div>
  )
}
