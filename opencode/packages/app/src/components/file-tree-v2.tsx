import { useFile } from "@/context/file"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import "@opencode-ai/ui/v2/file-tree-v2.css"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  splitProps,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { motionDuration, prefersReducedMotion } from "@opencode-ai/ui/v2/motion"
import { pathToFileUrl, withFileDragImage, type Kind } from "@/components/file-tree"
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import {
  buildFileTreeV2Model,
  flattenFileTreeV2,
  flattenLiveFileTreeV2,
  normalizeFileTreeV2Path,
  type FileTreeV2Node,
} from "@/components/file-tree-v2-model"
import { virtualScrollElement } from "@/components/virtual-scroll-element"

export type { Kind } from "@/components/file-tree"

const INDENT_STEP = 16

function rowPaddingStart(level: number, type: FileNode["type"]) {
  if (type === "directory") return 8 + level * INDENT_STEP
  if (level === 0) return 8
  return 8 + level * INDENT_STEP - INDENT_STEP
}

function guideLineStart(level: number) {
  return rowPaddingStart(level, "directory") + 8
}

export const kindLabel = (kind: Kind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

export const kindChange = (kind: Kind) => {
  if (kind === "add") return "added"
  if (kind === "del") return "deleted"
  return "modified"
}

const FileTreeNodeV2 = (
  p: ParentProps &
    ComponentProps<"div"> &
    ComponentProps<"button"> & {
      node: FileNode
      level: number
      active?: string
      draggable: boolean
      kinds?: ReadonlyMap<string, Kind>
      as?: "div" | "button"
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "draggable",
    "kinds",
    "as",
    "children",
    "class",
    "classList",
  ])
  const kind = () => local.kinds?.get(normalizeFileTreeV2Path(local.node.path))

  return (
    <Dynamic
      component={local.as ?? "div"}
      data-slot="file-tree-v2-row"
      data-path={local.node.path}
      data-selected={local.node.path === local.active ? "" : undefined}
      data-ignored={local.node.ignored ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={`padding-inline-start: ${rowPaddingStart(local.level, local.node.type)}px`}
      draggable={local.draggable}
      onDragStart={(event: DragEvent) => {
        if (!local.draggable) return
        event.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
        event.dataTransfer?.setData("text/uri-list", pathToFileUrl(local.node.path))
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
        withFileDragImage(event)
      }}
      {...rest}
    >
      {local.children}
      <span class="flex-1 min-w-0 text-start text-12-medium whitespace-nowrap truncate">
        <bdi dir="auto">{local.node.name}</bdi>
      </span>
      {(() => {
        const value = kind()
        if (!value || local.node.type !== "file") return null
        return (
          <span data-slot="file-tree-v2-change" data-change={kindChange(value)}>
            {kindLabel(value)}
          </span>
        )
      })()}
    </Dynamic>
  )
}

function GuideLines(props: { level: number }) {
  return (
    <For each={Array.from({ length: props.level })}>
      {(_, index) => <div data-slot="file-tree-v2-guide" style={`inset-inline-start: ${guideLineStart(index())}px`} />}
    </For>
  )
}

export default function FileTreeV2(props: {
  active?: string
  /**
   * A folder opened from a reply: its row glides into view, flashes, keeps an accent, and expands.
   * Each new object replays that, even for the same path.
   */
  revealed?: { path: string }
  allowed?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void
  onFileDoubleClick?: (file: FileNode) => void
}) {
  const file = useFile()
  const live = () => props.allowed === undefined
  const draggable = () => props.draggable ?? true
  const active = () => normalizeFileTreeV2Path(props.active ?? "")
  const model = createMemo(() => (live() ? undefined : buildFileTreeV2Model(props.allowed ?? [])))
  const expanded = (path: string) => file.tree.state(path)?.expanded ?? !live()
  const rows = createMemo(() => {
    if (live()) return flattenLiveFileTreeV2((path) => file.tree.children(path), expanded)
    return flattenFileTreeV2(model()!, expanded)
  })
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [focused, setFocused] = createSignal<string>()
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return rows().length
    },
    getScrollElement: () => virtualScrollElement(root()),
    initialRect: { width: 0, height: 600 },
    estimateSize: () => 28,
    gap: 2,
    overscan: 10,
    get getItemKey() {
      const current = rows()
      return (index: number) => current[index]?.node.path ?? index
    },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const path = focused()
      const index = path ? rows().findIndex((row) => row.node.path === path) : -1
      if (index < 0 || indexes.includes(index)) return indexes
      return [...indexes, index].sort((a, b) => a - b)
    },
  })

  createEffect(() => {
    if (!live()) return
    void file.tree.list("")
  })

  const revealed = () => normalizeFileTreeV2Path(props.revealed?.path ?? "")
  // The folder whose row is flashing; cleared once the reveal has played, so rows the virtualizer
  // mounts again later do not replay it.
  const [flash, setFlash] = createSignal<string>()

  // Only scroll when the active path changes (or first appears in the tree).
  // Do not re-scroll when expand/collapse reshuffles `rows()`.
  let scrolledActive: string | undefined
  let scrolledReveal: { path: string } | undefined
  createEffect(() => {
    const path = active()
    const reveal = props.revealed
    if (!path) {
      scrolledActive = undefined
      return
    }
    const index = rows().findIndex((row) => row.node.path === path)
    if (index < 0) return
    if (scrolledActive === path && scrolledReveal === reveal) return
    scrolledActive = path
    scrolledReveal = reveal
    queueMicrotask(() => {
      const next = rows().findIndex((row) => row.node.path === path)
      if (next < 0) return
      if (virtualizer.range && next >= virtualizer.range.startIndex && next <= virtualizer.range.endIndex) return
      if (path === revealed() && !prefersReducedMotion())
        virtualizer.scrollToIndex(next, { align: "center", behavior: "smooth" })
      else virtualizer.scrollToIndex(next, { align: "auto" })
    })
  })

  const selectFile = (node: FileTreeV2Node, action?: (file: FileNode) => void) => {
    action?.({
      ...node,
      path: node.originalPath,
      absolute: node.originalPath,
    })
  }

  const toggleDirectory = (path: string, originalPath: string) => {
    if (expanded(path)) {
      file.tree.collapse(originalPath)
      return
    }
    file.tree.expand(originalPath, live() ? undefined : { list: false })
  }

  // Each reveal flashes the row and, once it has glided into view, opens the folder, so its chevron
  // turns and its children fade in where the eye already is. A newer reveal cancels the pending one.
  createEffect(
    on(
      () => props.revealed,
      (reveal) => {
        setFlash(undefined)
        if (!reveal) return
        const path = normalizeFileTreeV2Path(reveal.path)
        const motion = !prefersReducedMotion()
        // A frame apart, so a repeat reveal of the same row restarts its animation.
        const frame = motion ? requestAnimationFrame(() => setFlash(path)) : undefined
        const expand = setTimeout(
          () => {
            const row = rows().find((item) => item.node.path === path)
            if (!expanded(path)) file.tree.expand(row?.node.originalPath ?? path, live() ? undefined : { list: false })
          },
          // Roughly how long the smooth scroll to the folder takes (file-tree-v2.css times the wash to it).
          motion ? motionDuration("medium") : 0,
        )
        // The row's wash (twice long) and its children's fade-in have played by then.
        const settle = motion ? setTimeout(() => setFlash(undefined), motionDuration("long") * 2) : undefined
        onCleanup(() => {
          if (frame !== undefined) cancelAnimationFrame(frame)
          clearTimeout(expand)
          clearTimeout(settle)
        })
      },
    ),
  )
  const revealChild = (path: string) => {
    const parent = flash()
    return !!parent && path.startsWith(`${parent}/`) && !path.slice(parent.length + 1).includes("/")
  }

  const rowByKey = createMemo(() => new Map(rows().map((row) => [row.node.path, row] as const)))
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key))

  return (
    <div
      ref={setRoot}
      data-component="file-tree-v2"
      data-total-rows={live() ? rows().length : model()!.total}
      class="group/file-tree-v2"
      style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}
    >
      <For each={virtualRowKeys()}>
        {(key) => (
          <Show when={virtualItemByKey().get(key)}>
            {(item) => (
              <div
                style={{
                  position: "absolute",
                  top: "0",
                  "inset-inline-start": "0",
                  width: "100%",
                  height: `${item().size}px`,
                  transform: `translateY(${item().start}px)`,
                }}
              >
                <Show when={rowByKey().get(key as string)}>
                  {(row) => (
                    <Show
                      when={row().node.type === "directory"}
                      fallback={
                        <FileTreeNodeV2
                          node={row().node}
                          level={row().level}
                          active={active()}
                          draggable={draggable()}
                          kinds={props.kinds}
                          as="button"
                          type="button"
                          class="relative"
                          data-reveal-child={revealChild(row().node.path) ? "" : undefined}
                          onFocus={() => setFocused(row().node.path)}
                          onBlur={() => setFocused(undefined)}
                          onClick={() => selectFile(row().node, props.onFileClick)}
                          onDblClick={() => selectFile(row().node, props.onFileDoubleClick)}
                        >
                          <GuideLines level={row().level} />
                          <Show when={row().level > 0}>
                            <div class="w-4 shrink-0" />
                          </Show>
                          <span class="filetree-iconpair size-4">
                            <FileIcon node={row().node} class="size-4 filetree-icon filetree-icon--color" />
                            <FileIcon node={row().node} class="size-4 filetree-icon filetree-icon--mono" mono />
                          </span>
                        </FileTreeNodeV2>
                      }
                    >
                      <FileTreeNodeV2
                        node={row().node}
                        level={row().level}
                        active={active()}
                        draggable={draggable()}
                        kinds={props.kinds}
                        as="button"
                        type="button"
                        class="relative"
                        data-revealed={row().node.path === revealed() ? "" : undefined}
                        data-reveal-flash={row().node.path === flash() ? "" : undefined}
                        data-reveal-child={revealChild(row().node.path) ? "" : undefined}
                        onFocus={() => setFocused(row().node.path)}
                        onBlur={() => setFocused(undefined)}
                        aria-expanded={expanded(row().node.path)}
                        onClick={() => toggleDirectory(row().node.path, row().node.originalPath)}
                      >
                        <GuideLines level={row().level} />
                        <div
                          data-slot="file-tree-v2-chevron"
                          data-expanded={expanded(row().node.path) ? "" : undefined}
                          class="size-4 flex items-center justify-center"
                        >
                          <Icon name="chevron-down" />
                        </div>
                      </FileTreeNodeV2>
                    </Show>
                  )}
                </Show>
              </div>
            )}
          </Show>
        )}
      </For>
    </div>
  )
}
