import { createEffect, createSignal, on, onCleanup, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { motionDuration, prefersReducedMotion } from "@opencode-ai/ui/v2/motion"
import {
  FileReferenceProvider,
  type FileReference,
  type FileReferenceActions,
  type FileReferencePreview,
} from "@opencode-ai/session-ui/context"
import { resolveFileReferencePath } from "@opencode-ai/session-ui/markdown-file-reference"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { SESSION_OPEN_FILE_TAB } from "@/context/layout-tabs"
import { useSessionLayout } from "@/pages/session/session-layout"
import { showToast } from "@/utils/toast"

export type FileReveal = { directory: string; path: string; start?: number; end?: number; folder?: boolean }

// The Files view opens its tree sidebar for the newest reveal. A file's viewer scrolls to and marks its
// lines once, then clears it; a folder's tree row is scrolled to, selected and expanded. Module state is
// enough because one session page, and one Files view, is mounted at a time.
const [fileReveal, setFileReveal] = createSignal<FileReveal | undefined>(undefined, { equals: false })
export { fileReveal }
export const clearFileReveal = () => setFileReveal(undefined)

// False while the right panel slides open: its content fades in, and a reveal starts, once it is true.
const [panelSettled, setPanelSettled] = createSignal(true)
export { panelSettled }
let slideTimer: ReturnType<typeof setTimeout> | undefined

/** Called as the right panel starts opening. With reduced motion there is no slide to wait for. */
export function slidePanelOpen() {
  clearTimeout(slideTimer)
  const still = prefersReducedMotion()
  setPanelSettled(still)
  if (still) return
  // The panel and the thread column slide over the medium duration (duration-medium in session.tsx).
  slideTimer = setTimeout(() => setPanelSettled(true), motionDuration("medium"))
}

/**
 * Supplies file-reference actions to assistant replies: the hover peek reads lines through the same
 * file API the Files tab uses, and opening reveals the file or folder in the right panel. Every path is
 * checked against the thread's folder again here, so a reference never reads outside it.
 */
export function SessionFileReferences(props: ParentProps) {
  const file = useFile()
  const sdk = useSDK()
  const language = useLanguage()
  const { tabs, view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const locate = async (reference: FileReference) => {
    const path = resolveFileReferencePath(reference.path, sdk().directory)
    if (!path) return
    // A trailing slash asks for a folder and a file name for a file; an extensionless path takes what is there.
    const type = await entryType(path)
    if (type === "directory" && reference.kind) return { path, folder: true }
    if (type === "file" && reference.kind !== "folder") return { path, folder: false }
    if (reference.kind || path.includes("/")) return
    // A bare name such as `harness.ts` falls back to the file index, but only an unambiguous match counts.
    const matches = await file.searchFiles(path, { limit: 50 })
    const named = [...new Set(matches.filter((item) => item === path || item.endsWith(`/${path}`)))]
    if (named.length === 1) return { path: named[0], folder: false }
  }

  const entryType = async (path: string) => {
    const nodes = await listed(path.split("/").slice(0, -1).join("/"))
    return nodes?.find((node) => file.normalize(node.path).replaceAll("\\", "/") === path)?.type
  }

  // Listed directly so a missing folder stays quiet instead of raising the tree's error toast.
  const listed = (dir: string) => {
    if (file.tree.state(dir)?.loaded) return Promise.resolve(file.tree.children(dir))
    return sdk()
      .client.file.list({ path: dir })
      .then(
        (result) => result.data ?? [],
        () => undefined,
      )
  }

  // Prose such as `and/or` or `owner/repo` rarely starts with a top-level folder, so the root listing,
  // read once per thread folder, screens extensionless paths before their parent folder is listed.
  let rootFolders: { directory: string; names: Promise<Set<string>> } | undefined
  const listedEntry = async (input: string) => {
    const directory = sdk().directory
    const path = resolveFileReferencePath(input, directory)
    if (!path) return
    if (rootFolders?.directory !== directory) {
      const current = {
        directory,
        names: listed("").then((nodes) => {
          if (!nodes && rootFolders === current) rootFolders = undefined
          return new Set(
            (nodes ?? [])
              .filter((node) => node.type === "directory")
              .map((node) => file.normalize(node.path).replaceAll("\\", "/")),
          )
        }),
      }
      rootFolders = current
    }
    if (!(await rootFolders.names).has(path.split("/")[0])) return
    return entryType(path)
  }

  const readFileRange = async (reference: FileReference, limit: number): Promise<FileReferencePreview> => {
    const found = await locate(reference)
    if (!found) return { status: "missing", path: reference.path }
    const path = found.path
    if (found.folder) return { status: "folder", path, count: (await listed(path))?.length ?? 0 }
    const content = file.get(path)?.content ?? (await sdk().client.file.read({ path })).data
    if (!content || content.type === "binary" || content.encoding === "base64") return { status: "binary", path }
    const start = reference.start ?? 1
    const last = reference.start ? Math.min(reference.end ?? start, start + limit - 1) : limit
    return { status: "found", path, start, lines: content.content.split(/\r?\n/).slice(start - 1, last) }
  }

  const onFileReference = (reference: FileReference) => {
    const directory = sdk().directory
    void locate(reference).then((found) => {
      if (sdk().directory !== directory) return
      if (!found) {
        showToast({
          variant: "error",
          title: language.t(
            reference.kind === "folder"
              ? "secondBrain.fileReference.folderMissing"
              : "secondBrain.fileReference.missing",
          ),
          description: reference.path,
        })
        return
      }
      const path = found.path
      view().reviewPanel.open()
      // Expanding each ancestor lists it, so the tree can find, scroll to and select the row. A folder
      // itself is expanded by the tree once its row is in view.
      const dirs = path.split("/").slice(0, -1)
      dirs.forEach((_, index) => file.tree.expand(dirs.slice(0, index + 1).join("/")))
      if (found.folder) {
        // The tree sits beside any file tab; otherwise the Open file tab shows it.
        const active = tabs().active()
        if (active !== SESSION_OPEN_FILE_TAB && !(active && file.pathFromTab(active))) {
          tabs().previewTab(SESSION_OPEN_FILE_TAB)
          queueMicrotask(() => tabs().setActive(SESSION_OPEN_FILE_TAB))
        }
        setFileReveal({ directory, path, folder: true })
        return
      }
      const tab = file.tab(path)
      tabs().previewTab(tab)
      // As in the side panel: Kobalte can briefly select Review while the preview trigger is replaced.
      queueMicrotask(() => tabs().setActive(tab))
      void file.load(path)
      const start = reference.start
      const end = start && (reference.end ?? start)
      // The viewer selects the lines when it highlights them, so the steady tint arrives with the highlight.
      setFileReveal({ directory, path, start, end })
    })
  }

  // A reveal waits for its view to mount; one that never did must not replay when a later view mounts.
  createEffect(
    on(
      () => view().reviewPanel.opened(),
      (opened) => {
        if (!opened) clearFileReveal()
      },
      { defer: true },
    ),
  )
  onCleanup(clearFileReveal)

  const actions = {
    get directory() {
      return sdk().directory
    },
    readFileRange,
    entryType: listedEntry,
    onFileReference,
  } satisfies FileReferenceActions

  // The right panel only exists on desktop widths; elsewhere references stay plain code.
  return (
    <FileReferenceProvider value={() => (isDesktop() ? actions : undefined)}>{props.children}</FileReferenceProvider>
  )
}
