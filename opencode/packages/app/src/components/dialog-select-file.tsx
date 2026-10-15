import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { Dialog, DialogBody } from "@opencode-ai/ui/v2/dialog-v2"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { createMemo, createSignal, lazy, Show } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import {
  createCommandPaletteFileEntry,
  createCommandPaletteFileOpener,
  createCommandPaletteModel,
  uniqueCommandPaletteEntries,
  type CommandPaletteEntry,
} from "./command-palette"
import { DialogCommandPaletteV2 } from "./dialog-command-palette-v2"
import { listV2Class } from "./surface-classes"

const DialogSelectFileV2 = lazy(() =>
  import("./dialog-select-directory-v2").then((module) => ({ default: module.DialogSelectDirectoryV2 })),
)
type DialogSelectFileMode = "all" | "files"

export function DialogSelectFile(props: { mode?: DialogSelectFileMode; onOpenFile?: (path: string) => void }) {
  const platform = usePlatform()
  const filesOnly = () => props.mode === "files"

  if (!filesOnly()) {
    return <DialogCommandPaletteV2 onOpenFile={props.onOpenFile} />
  }

  if (platform.platform === "desktop") {
    return <DialogSelectFileDesktopV2 onOpenFile={props.onOpenFile} />
  }

  return <DialogSelectFileLegacy filesOnly={filesOnly} onOpenFile={props.onOpenFile} />
}

function DialogSelectFileDesktopV2(props: { onOpenFile?: (path: string) => void }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const { params } = useSessionLayout()
  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const openFile = createCommandPaletteFileOpener(props.onOpenFile)

  return (
    <DialogSelectFileV2
      server={serverSDK().server}
      mode="file"
      start={projectDirectory()}
      title={language.t("session.header.searchFiles")}
      onSelect={(result) => {
        if (typeof result !== "string") return
        openFile(result)
      }}
    />
  )
}

function DialogSelectFileLegacy(props: { filesOnly: () => boolean; onOpenFile?: (path: string) => void }) {
  const palette = createCommandPaletteModel(props)
  const [grouped, setGrouped] = createSignal(false)

  const items = async (text: string) => {
    const query = text.trim()
    setGrouped(query.length > 0)

    if (!query && props.filesOnly()) {
      const loaded = palette.file.tree.state("")?.loaded
      const pending = loaded ? Promise.resolve() : palette.file.tree.list("")
      const next = uniqueCommandPaletteEntries([...palette.recentFileEntries(), ...palette.rootFileEntries()])

      if (loaded || next.length > 0) {
        void pending
        return next
      }

      await pending
      return uniqueCommandPaletteEntries([...palette.recentFileEntries(), ...palette.rootFileEntries()])
    }

    if (!query) return [...palette.preferredCommandEntries(), ...palette.recentFileEntries()]

    if (props.filesOnly()) {
      const files = await palette.file.searchFiles(query)
      const category = palette.language.t("palette.group.files")
      return files.map((path) => createCommandPaletteFileEntry(path, category))
    }

    const [files, nextSessions] = await Promise.all([
      palette.file.searchFiles(query),
      Promise.resolve(palette.sessions(query)),
    ])
    const category = palette.language.t("palette.group.files")
    const entries = files.map((path) => createCommandPaletteFileEntry(path, category))
    return [...palette.commandEntries(), ...nextSessions, ...entries]
  }

  // Only reached in files-only mode, so every entry is a file; other entries fall back to their title.
  return (
    <Dialog size="large">
      <DialogBody class="min-h-0 pt-3">
        <List
          class={`flex-1 min-h-0 px-3 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${listV2Class}`}
          search={{
            placeholder: props.filesOnly()
              ? palette.language.t("session.header.searchFiles")
              : palette.language.t("palette.search.placeholder"),
            autofocus: true,
            hideIcon: true,
          }}
          emptyMessage={palette.language.t("palette.empty")}
          loadingMessage={palette.language.t("common.loading")}
          items={items}
          key={(item) => item.id}
          filterKeys={["title", "description", "category"]}
          skipFilter={(item) => item.type === "file"}
          groupBy={grouped() ? (item) => item.category : () => ""}
          onMove={(item: CommandPaletteEntry | undefined) => palette.highlight(item)}
          onSelect={(item: CommandPaletteEntry | undefined) => palette.select(item)}
        >
          {(item) => (
            <Show when={item.type === "file"} fallback={<span class="truncate">{item.title}</span>}>
              <div class="flex w-full min-w-0 items-center gap-x-3">
                <FileIcon node={{ path: item.path ?? "", type: "file" }} class="size-4 shrink-0" />
                <div class="flex min-w-0 items-center">
                  <span class="min-w-0 truncate whitespace-nowrap opacity-70">{getDirectory(item.path ?? "")}</span>
                  <span class="whitespace-nowrap [font-weight:530]">{getFilename(item.path ?? "")}</span>
                </div>
              </div>
            </Show>
          )}
        </List>
      </DialogBody>
    </Dialog>
  )
}
