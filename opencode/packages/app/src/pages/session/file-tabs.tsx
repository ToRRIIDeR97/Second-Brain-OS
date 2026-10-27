import { createEffect, createMemo, createSignal, Match, on, onCleanup, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/session-ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { createLineCommentControllerV2 } from "@opencode-ai/session-ui/v2/line-comment-annotations-v2"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { LineCommentV2OverflowIcon } from "@opencode-ai/ui/v2/line-comment-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@/utils/toast"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { clearFileReveal, fileReveal, panelSettled } from "@/pages/session/file-reference"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

type SessionFileViewProps = {
  tab: string
}

const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

// A file reference's code fades in for this long before it glides to the cited lines.
const REFERENCE_FADE_MS = 200
const REFERENCE_SCROLL_MS = 350

function FileCommentMenuV2(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <MenuV2 gutter={4}>
        <MenuV2.Trigger as="button" type="button" data-slot="line-comment-v2-overflow" aria-label={props.moreLabel}>
          <LineCommentV2OverflowIcon />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.Item onSelect={props.onEdit}>{props.editLabel}</MenuV2.Item>
            <MenuV2.Item onSelect={props.onDelete}>{props.deleteLabel}</MenuV2.Item>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()
    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (code().length > 0) return
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function FileTabContent(props: { tab: string }) {
  return (
    <TabsV2.Content value={props.tab}>
      <SessionFileView tab={props.tab} />
    </TabsV2.Content>
  )
}

export function SessionFileView(props: SessionFileViewProps) {
  return <SessionFileViewV2 tab={props.tab} />
}

function SessionFileViewV2(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const sdk = useSDK()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, lines: SelectedLineRange) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selectionFromLines(lines))
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, input.selection)

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, input.selection) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentControllerV2({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    mention: {
      items: file.searchFilesAndDirectories,
    },
    getSide: selectionSide,
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()
      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()
      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenuV2
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  // A file reference from a reply, once the panel has arrived and the lines render: the code fades in
  // where it is, glides to the lines, then selects and marks them. The selection gives the steady tint;
  // the mark adds the gutter accent and the wipe-in highlight. A newer reveal re-runs this effect, and
  // its cleanup cancels the frame in flight, so a second click retargets from wherever the glide is.
  let viewport: HTMLDivElement | undefined
  const referenceRoot = () => viewport?.querySelector("diffs-container")?.shadowRoot
  const clearReferenceMarks = () =>
    referenceRoot()
      ?.querySelectorAll("[data-file-reference]")
      .forEach((node) => node.removeAttribute("data-file-reference"))

  createEffect(() => {
    const reveal = fileReveal()
    const p = path()
    if (!reveal || reveal.directory !== sdk().directory || reveal.path !== p || !state()?.loaded) return
    if (!panelSettled()) return
    const start = reveal.start
    const end = reveal.end ?? start
    if (!start || !end) {
      requestAnimationFrame(clearFileReveal)
      return
    }
    setNote("selected", null)
    clearReferenceMarks()
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let frame: number | undefined
    // Ease-in-out scroll, after the code's fade-in; reduced motion lands on the end state at once.
    const glide = (el: HTMLDivElement, to: number, delay: number, done: () => void) => {
      const from = el.scrollTop
      const begin = performance.now() + (still ? 0 : delay)
      const step = (now: number) => {
        const t = still ? 1 : Math.min(1, Math.max(0, (now - begin) / REFERENCE_SCROLL_MS))
        el.scrollTop = from + (to - from) * (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2)
        frame = t < 1 ? requestAnimationFrame(step) : undefined
        if (t === 1) done()
      }
      frame = requestAnimationFrame(step)
    }
    const mark = (root: ShadowRoot) => {
      view().setScroll(props.tab, { x: 0, y: viewport?.scrollTop ?? 0 })
      // Selecting notifies the viewer's selection handler, which clears marks, so mark a frame later.
      file.setSelectedLines(p, { start, end })
      frame = requestAnimationFrame(() => {
        Array.from({ length: end - start + 1 }, (_, index) => start + index).forEach((number) =>
          root
            .querySelectorAll(`[data-line="${number}"], [data-column-number="${number}"]`)
            .forEach((node) => node.setAttribute("data-file-reference", "")),
        )
        clearFileReveal()
      })
    }
    const attempt = (count: number) => {
      frame = undefined
      const root = referenceRoot()
      const line = root?.querySelector(`[data-line="${start}"]`)
      if (!viewport || !root || !(line instanceof HTMLElement)) {
        // Large files render lazily; glide near the line so the virtualizer renders it, then look again.
        if (count === 10 && viewport && root?.querySelector("[data-line]")) {
          glide(viewport, (start - 1) * 24, REFERENCE_FADE_MS, () => attempt(11))
          return
        }
        if (count < 120) frame = requestAnimationFrame(() => attempt(count + 1))
        else clearFileReveal()
        return
      }
      const top = Math.max(
        0,
        line.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop -
          viewport.clientHeight / 3,
      )
      glide(viewport, top, count > 10 ? 0 : REFERENCE_FADE_MS, () => mark(root))
    }
    frame = requestAnimationFrame(() => attempt(0))
    onCleanup(() => {
      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40 animate-in fade-in duration-200 motion-reduce:animate-none">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          clearReferenceMarks()
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          if (!range) {
            commentsUi.note.select(null)
            commentsUi.note.cancelDraft()
            return
          }
          commentsUi.onLineSelectionEnd(range)
        }}
        onLineNumberSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineNumberSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  const content = () => (
    <div class="mt-3 relative h-full min-h-0">
      <ScrollView
        class="h-full"
        viewportRef={(el: HTMLDivElement) => {
          viewport = el
          scrollSync.setViewport(el)
        }}
        onScroll={scrollSync.handleScroll as any}
      >
        <Switch>
          <Match when={state()?.loaded}>{renderFile(contents())}</Match>
          <Match when={state()?.loading}>
            <div
              role="status"
              class="flex flex-col gap-2.5 px-6 py-4 animate-in fade-in duration-200 motion-reduce:animate-none"
            >
              <span class="sr-only">{language.t("common.loading")}...</span>
              {[72, 54, 64, 38, 58].map((width) => (
                <div
                  aria-hidden="true"
                  class="h-2.5 rounded-full bg-v2-background-bg-layer-01 animate-pulse motion-reduce:animate-none"
                  style={{ width: `${width}%` }}
                />
              ))}
            </div>
          </Match>
          <Match when={state()?.error}>
            {(err) => <div class="px-6 py-4 text-[13px] text-v2-state-fg-danger">{err()}</div>}
          </Match>
        </Switch>
      </ScrollView>
    </div>
  )

  return content()
}
