import { createSignal, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
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
import { useSessionLayout } from "@/pages/session/session-layout"
import { showToast } from "@/utils/toast"

export type FileReveal = { directory: string; path: string; start?: number; end?: number }

// The Files view opens its tree sidebar for the newest reveal, scrolls to and flashes its lines once,
// then clears it. Module state is enough because one session page, and one Files view, is mounted at a time.
const [fileReveal, setFileReveal] = createSignal<FileReveal | undefined>(undefined, { equals: false })
export { fileReveal }
export const clearFileReveal = () => setFileReveal(undefined)

/**
 * Supplies file-reference actions to assistant replies: the hover peek reads lines through the same
 * file API the Files tab uses, and opening reveals the file in the right panel. Every path is checked
 * against the thread's folder again here, so a reference never reads outside it.
 */
export function SessionFileReferences(props: ParentProps) {
  const file = useFile()
  const sdk = useSDK()
  const language = useLanguage()
  const { tabs, view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const locate = async (input: string) => {
    const path = resolveFileReferencePath(input, sdk().directory)
    if (!path) return
    if (await isFile(path)) return path
    if (path.includes("/")) return
    // A bare name such as `harness.ts` falls back to the file index, but only an unambiguous match counts.
    const matches = await file.searchFiles(path, { limit: 50 })
    const named = [...new Set(matches.filter((item) => item === path || item.endsWith(`/${path}`)))]
    if (named.length === 1) return named[0]
  }

  const isFile = (path: string) => {
    const dir = path.split("/").slice(0, -1).join("/")
    const match = (nodes: { path: string; type: string }[]) =>
      nodes.some((node) => node.type === "file" && file.normalize(node.path).replaceAll("\\", "/") === path)
    if (file.tree.state(dir)?.loaded) return Promise.resolve(match(file.tree.children(dir)))
    // Listed directly so a missing folder stays quiet instead of raising the tree's error toast.
    return sdk()
      .client.file.list({ path: dir })
      .then(
        (result) => match(result.data ?? []),
        () => false,
      )
  }

  const readFileRange = async (reference: FileReference, limit: number): Promise<FileReferencePreview> => {
    const path = await locate(reference.path)
    if (!path) return { status: "missing", path: reference.path }
    const content = file.get(path)?.content ?? (await sdk().client.file.read({ path })).data
    if (!content || content.type === "binary" || content.encoding === "base64") return { status: "binary", path }
    const start = reference.start ?? 1
    const last = reference.start ? Math.min(reference.end ?? start, start + limit - 1) : limit
    return { status: "found", path, start, lines: content.content.split(/\r?\n/).slice(start - 1, last) }
  }

  const onFileReference = (reference: FileReference) => {
    const directory = sdk().directory
    void locate(reference.path).then((path) => {
      if (sdk().directory !== directory) return
      if (!path) {
        showToast({
          variant: "error",
          title: language.t("secondBrain.fileReference.missing"),
          description: reference.path,
        })
        return
      }
      view().reviewPanel.open()
      // Expanding each ancestor lists it, so the tree can find, scroll to and select the file row.
      const dirs = path.split("/").slice(0, -1)
      dirs.forEach((_, index) => file.tree.expand(dirs.slice(0, index + 1).join("/")))
      const tab = file.tab(path)
      tabs().previewTab(tab)
      // As in the side panel: Kobalte can briefly select Review while the preview trigger is replaced.
      queueMicrotask(() => tabs().setActive(tab))
      void file.load(path)
      const start = reference.start
      const end = start && (reference.end ?? start)
      if (start && end) file.setSelectedLines(path, { start, end })
      setFileReveal({ directory, path, start, end })
    })
  }

  const actions = {
    get directory() {
      return sdk().directory
    },
    readFileRange,
    onFileReference,
  } satisfies FileReferenceActions

  // The right panel only exists on desktop widths; elsewhere references stay plain code.
  return (
    <FileReferenceProvider value={() => (isDesktop() ? actions : undefined)}>{props.children}</FileReferenceProvider>
  )
}
