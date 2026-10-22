import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  Match,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { createVirtualizer, defaultRangeExtractor, elementScroll, type VirtualItem } from "@tanstack/solid-virtual"
import { AccordionV2 } from "@opencode-ai/ui/v2/accordion-v2"
import {
  ContextToolGroup,
  ToolGroup,
  Message,
  MessageDivider,
  Part as MessagePart,
  partDefaultOpen,
  type UserActions,
} from "@opencode-ai/session-ui/message-part"
import { DiffChanges } from "@opencode-ai/ui/v2/diff-changes-v2"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SessionRetry } from "@opencode-ai/session-ui/session-retry"
import { isScrollKeyTarget, scrollKey, scrollKeyOwner, ScrollView } from "@opencode-ai/ui/scroll-view"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import type {
  AssistantMessage,
  Message as MessageType,
  Part as PartType,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { normalize } from "@opencode-ai/session-ui/session-diff"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSessionKey, useSessionLayout } from "@/pages/session/session-layout"
import { useSessionArchive } from "@/pages/session/session-archive"
import { useSettings } from "@/context/settings"
import { requireServerKey, sessionHref } from "@/utils/session-route"
import { useSDK } from "@/context/sdk"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { sessionTitle } from "@/utils/session-title"
import { scheduleConnectedMeasure } from "./measure"
import { observeElementOffsetReconnectAware } from "./observe-element-offset"
import { createTimelineProjection } from "./projection"
import { MessageComment, SummaryDiff, TimelineRow, TimelineRowMap } from "./rows"
import { filterVirtualIndexes } from "./virtual-items"
import { TurnStepsSummary } from "@/components/session/turn-steps-summary"
import { useData } from "@opencode-ai/session-ui/context"

const emptyMessages: MessageType[] = []
const emptyParts: PartType[] = []
const emptyTools: ToolPart[] = []
const emptyAssistantMessages: AssistantMessage[] = []
const idle = { type: "idle" as const }

type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, { _tag: "TurnGap" }>
type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>

const timelineFallbackItemSize = 60
// Matches the TurnSteps row: a 36px summary button plus 8px bottom padding.
const turnStepsRowSize = 44
const timelineCache = new Map<string, { measurements: VirtualItem[]; toolOpen: Record<string, boolean | undefined> }>()

const taskDescription = (part: PartType, sessionID: string) => {
  if (part.type !== "tool" || part.tool !== "task") return
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
}

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

function TimelineThinkingRow(props: { reasoningHeading?: string; showReasoningSummaries: boolean }) {
  const language = useLanguage()

  return (
    <div data-slot="session-turn-thinking">
      <TextShimmer text={language.t("ui.sessionTurn.status.thinking")} />
      <Show when={!props.showReasoningSummaries}>
        <TextReveal text={props.reasoningHeading} class="session-turn-thinking-heading" travel={25} duration={700} />
      </Show>
    </div>
  )
}

function TimelineDiffSummaryRow(props: { diffs: SummaryDiff[] }) {
  const language = useLanguage()
  const maxFiles = 10
  const [state, setState] = createStore({
    showAll: false,
    expanded: [] as string[],
  })
  const showAll = () => state.showAll
  const expanded = () => state.expanded
  const overflow = createMemo(() => Math.max(0, props.diffs.length - maxFiles))
  const visible = createMemo(() => (showAll() ? props.diffs : props.diffs.slice(0, maxFiles)))

  return (
    <div
      data-slot="session-turn-diffs"
      data-component="session-turn-diffs-group"
      data-show-all={showAll() || undefined}
    >
      <div data-slot="session-turn-diffs-header">
        <span data-slot="session-turn-diffs-label">
          {language.plural("ui.sessionTurn.diffs.changed", props.diffs.length)}
        </span>
        <DiffChanges changes={props.diffs} />
        <Show when={overflow() > 0}>
          <span data-slot="session-turn-diffs-toggle" onClick={() => setState("showAll", !showAll())}>
            {showAll() ? language.t("ui.sessionTurn.diffs.showLess") : language.t("ui.sessionTurn.diffs.showAll")}
          </span>
        </Show>
      </div>
      <div data-component="session-turn-diffs-content">
        <AccordionV2
          multiple
          class="thread-collapsibles"
          style={{ "--sticky-accordion-offset": "44px" }}
          value={expanded()}
          onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
        >
          <For each={visible()}>
            {(diff) => {
              const opened = createMemo(() => expanded().includes(diff.file))

              return (
                <AccordionV2.Item value={diff.file}>
                  <AccordionV2.Header>
                    <AccordionV2.Trigger>
                      <div data-slot="session-turn-diff-trigger">
                        <span data-slot="session-turn-diff-path">
                          <Show when={diff.file.includes("/")}>
                            <span data-slot="session-turn-diff-directory">{`\u202A${getDirectory(diff.file)}\u202C`}</span>
                          </Show>
                          <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                        </span>
                        <div data-slot="session-turn-diff-meta">
                          <span data-slot="session-turn-diff-changes">
                            <DiffChanges changes={diff} />
                          </span>
                        </div>
                      </div>
                    </AccordionV2.Trigger>
                  </AccordionV2.Header>
                  <AccordionV2.Content>
                    <Show when={opened()}>
                      <TimelineDiffView diff={diff} />
                    </Show>
                  </AccordionV2.Content>
                </AccordionV2.Item>
              )
            }}
          </For>
        </AccordionV2>
        <Show when={!showAll() && overflow() > 0}>
          <div data-slot="session-turn-diffs-more" onClick={() => setState("showAll", true)}>
            {language.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
          </div>
        </Show>
      </div>
    </div>
  )
}

function TimelineDiffView(props: { diff: SummaryDiff }) {
  const fileComponent = useFileComponent()
  const view = normalize(props.diff)

  return (
    <div data-slot="session-turn-diff-view" data-scrollable>
      <Dynamic component={fileComponent} mode="diff" virtualize={false} fileDiff={view.fileDiff} />
    </div>
  )
}

export function MessageTimeline(props: {
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onHistoryScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  shouldAnchorBottom: () => boolean
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  userMessages: UserMessage[]
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string) => void) => void
  setScrollToEnd?: (fn: () => void) => void
  setHistoryAnchor?: (handlers: { capture: () => void; restore: (done: boolean) => void }) => void
}) {
  let touchGesture: number | undefined

  const navigate = useNavigate()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const sync = useSync()
  const settings = useSettings()
  const dialog = useDialog()
  const sessionArchive = useSessionArchive()
  const language = useLanguage()
  const data = useData()
  const { params, sessionKey } = useSessionKey()
  const ownerSessionKey = sessionKey()
  const cached = timelineCache.get(ownerSessionKey)
  const initialMeasurements = cached?.measurements
  const coldBottomMount = !initialMeasurements?.length && props.shouldAnchorBottom()

  const [listRoot, setListRoot] = createSignal<HTMLDivElement>()
  const sessionID = createMemo(() => params.id)
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync().data.session_status[id] ?? idle
  })
  const sessionMessages = createMemo(() => (sessionID() ? (sync().data.message[sessionID()!] ?? []) : []))
  const projectedMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const visible = new Set(props.userMessages.map((message) => message.id))
    const boundary = sessionMessages().find((message) => message.role === "user" && !visible.has(message.id))?.id
    const messages = sync().data.session_message[id] ?? []
    if (!boundary) return messages
    const index = messages.findIndex((message) => message.id === boundary)
    return index < 0 ? messages : messages.slice(0, index)
  })
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync().session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const sessionView = useSessionLayout().view
  const changes = createMemo(() => {
    const summary = info()?.summary
    if (!summary || summary.additions + summary.deletions === 0) return
    return summary
  })
  const titleLabel = createMemo(() => sessionTitle(titleValue()))
  const parentID = createMemo(() => info()?.parentID)
  const parent = createMemo(() => {
    const id = parentID()
    if (!id) return
    return sync().session.get(id)
  })
  const parentMessages = createMemo(() => {
    const id = parentID()
    if (!id) return emptyMessages
    return sync().data.message[id] ?? emptyMessages
  })
  const parentTitle = createMemo(() => sessionTitle(parent()?.title) ?? language.t("command.session.new"))
  const getMsgParts = (msgId: string) => sync().data.part[msgId] ?? emptyParts
  const getMsgPart = (messageID: string, partID: string) => getMsgParts(messageID).find((part) => part.id === partID)
  const childTaskDescription = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return parentMessages()
      .flatMap((message) => getMsgParts(message.id))
      .map((part) => taskDescription(part, id))
      .findLast((value): value is string => !!value)
  })
  const childTitle = createMemo(() => {
    if (!parentID()) return titleLabel() ?? ""
    if (childTaskDescription()) return childTaskDescription()
    const value = titleLabel()?.replace(/\s+\(@[^)]+ subagent\)$/, "")
    if (value) return value
    return language.t("command.session.new")
  })
  const showHeader = createMemo(() => !!(titleValue() || parentID()))
  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>(cached?.toolOpen ?? {})
  // A user toggle wins; otherwise steps open only when one failed. A working turn shows its live ticker instead.
  const turnStepsOpen = (row: TimelineRow.TurnSteps) =>
    toolOpen[`turn:${row.userMessageID}:${row.segment}`] ?? row.failed
  const projection = createTimelineProjection({
    messages: sessionMessages,
    userMessages: () => props.userMessages,
    sessionMessages: projectedMessages,
    parts: getMsgParts,
    status: sessionStatus,
    showReasoningSummaries: settings.general.showReasoningSummaries,
    inlineComments: () => true,
    folded: (row) => !turnStepsOpen(row),
  })
  const activeMessageID = projection.activeMessageID
  const assistantMessagesByParent = projection.assistantMessagesByParent
  const lastAssistantGroupKey = projection.lastAssistantGroupKey
  const messageByID = projection.messageByID
  const messageLastRowIndex = projection.messageLastRowIndex
  const messageRowIndex = projection.messageRowIndex
  const timelineRowByKey = projection.rowByKey
  const timelineRows = projection.rows

  let prependAnchor: { key: string; offset: number } | undefined
  let prependAnchorFrame: number | undefined
  let prependLoading = false
  const clearPrependAnchor = () => {
    prependLoading = false
    prependAnchor = undefined
    if (prependAnchorFrame === undefined) return
    cancelAnimationFrame(prependAnchorFrame)
    prependAnchorFrame = undefined
  }
  const capturePrependAnchor = () => {
    prependLoading = true
    updatePrependAnchor()
  }
  const updatePrependAnchor = () => {
    const root = listRoot()
    if (!root) return
    const view = root.getBoundingClientRect()
    const anchor = [...root.querySelectorAll<HTMLElement>("[data-timeline-key]")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter((item) => item.rect.bottom > view.top && item.rect.top < view.bottom)
      .sort((a, b) => a.rect.top - b.rect.top)[0]
    if (!anchor) return
    if (!anchor.element.dataset.timelineKey) return
    prependAnchor = { key: anchor.element.dataset.timelineKey, offset: anchor.rect.top - view.top }
  }
  const restorePrependAnchor = (done: boolean) => {
    if (done) prependLoading = false
    applyPrependAnchor()
  }
  const applyPrependAnchor = () => {
    const root = listRoot()
    if (!root || !prependAnchor) return
    if (prependAnchorFrame !== undefined) cancelAnimationFrame(prependAnchorFrame)
    let frames = 0
    let stable = 0
    const apply = () => {
      prependAnchorFrame = undefined
      const anchor = prependAnchor
      if (!anchor) return
      const element = root.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(anchor.key)}"]`)
      const delta = element
        ? element.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset
        : undefined
      if (delta !== undefined && Math.abs(delta) > 0.5) {
        root.scrollTop += delta
        stable = 0
      } else {
        stable += 1
      }
      frames += 1
      if (stable >= 30 || frames >= 180) {
        if (!prependLoading) prependAnchor = undefined
        return
      }
      prependAnchorFrame = requestAnimationFrame(apply)
    }
    prependAnchorFrame = requestAnimationFrame(apply)
  }

  const [renderOverscan, setRenderOverscan] = createSignal(initialMeasurements?.length || coldBottomMount ? 6 : 20)
  let resizePinnedIndexes: number[] = []
  let resizePinFrame: number | undefined
  let virtualContent: HTMLDivElement | undefined
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return timelineRows().length
    },
    getScrollElement: () => listRoot() ?? null,
    observeElementOffset: observeElementOffsetReconnectAware,
    initialOffset: () => (props.shouldAnchorBottom() ? Number.MAX_SAFE_INTEGER : 0),
    initialMeasurementsCache: initialMeasurements,
    // A turn-steps header has a fixed height; estimating it exactly keeps the rows below it from shifting on mount.
    estimateSize: (index) =>
      timelineRows()[index]?._tag === "TurnSteps" ? turnStepsRowSize : timelineFallbackItemSize,
    scrollToFn: (offset, options, instance) => {
      // Expose the computed range before core writes an anchor correction so the browser does not clamp it to the old height.
      if (virtualContent) virtualContent.style.height = `${instance.getTotalSize()}px`
      elementScroll(offset, options, instance)
    },
    get getItemKey() {
      const rows = timelineRows()
      return (index: number) => {
        const row = rows[index]
        // ResizeObserver can report a removed element after its row has left the projection.
        if (!row) return `removed:${index}`
        return TimelineRow.key(row)
      }
    },
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    get scrollMargin() {
      return showHeader() ? 64 : 0
    },
    overscan: 50,
    paddingEnd: 64,
    rangeExtractor: (range) => {
      const id = activeMessageID()
      const active = id ? (messageLastRowIndex().get(id) ?? -1) : -1
      const indexes = defaultRangeExtractor({ ...range, overscan: renderOverscan() })
      return filterVirtualIndexes(
        [...new Set([...resizePinnedIndexes, ...indexes, ...(active < 0 ? [] : [active])])].sort((a, b) => a - b),
        range.count,
      )
    },
  })
  const resizeItem = virtualizer.resizeItem
  let resizeAnchorScheduled = false
  const anchorResizedBottom = () => {
    if (resizeAnchorScheduled || props.hasScrollGesture()) return
    resizeAnchorScheduled = true
    queueMicrotask(() => {
      resizeAnchorScheduled = false
      if (!props.shouldAnchorBottom() || props.hasScrollGesture()) return
      virtualizer.scrollToEnd()
    })
  }
  virtualizer.resizeItem = (index, size) => {
    const item = virtualizer.measurementsCache[index]
    const previous = item ? (virtualizer.itemSizeCache.get(item.key) ?? item.size) : undefined
    const root = listRoot()
    if (root && previous !== undefined && Math.abs(size - previous) > root.clientHeight) {
      const view = root.getBoundingClientRect()
      resizePinnedIndexes = [...root.querySelectorAll<HTMLElement>("[data-index]")]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.bottom > view.top && rect.top < view.bottom
        })
        .map((element) => Number(element.dataset.index))
      if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
      resizePinFrame = requestAnimationFrame(() => {
        resizePinFrame = requestAnimationFrame(() => {
          resizePinFrame = undefined
          resizePinnedIndexes = []
        })
      })
    }
    resizeItem(index, size)
    if (root && props.shouldAnchorBottom()) anchorResizedBottom()
  }
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
    if (props.shouldAnchorBottom()) return false
    const first = virtualizer.range?.startIndex
    return first !== undefined && item.index < first
  }
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key as string))
  createEffect(() => {
    props.setRevealMessage?.((id) => {
      const index = messageRowIndex().get(id)
      if (index === undefined) return
      virtualizer.scrollToIndex(index, { align: "center" })
    })
    props.setScrollToEnd?.(() => virtualizer.scrollToEnd())
    props.setHistoryAnchor?.({ capture: capturePrependAnchor, restore: restorePrependAnchor })
  })

  let overscanFrame: number | undefined
  onMount(() => {
    overscanFrame = requestAnimationFrame(() => {
      if (props.shouldAnchorBottom()) virtualizer.scrollToEnd()
      overscanFrame = requestAnimationFrame(() => {
        overscanFrame = undefined
        if (renderOverscan() < 20) setRenderOverscan(20)
        if (props.shouldAnchorBottom()) virtualizer.scrollToEnd()
      })
    })
  })

  const maybeAnchorBottom = () => {
    if (timelineRows().length === 0) return
    if (!props.shouldAnchorBottom() || props.hasScrollGesture()) return
    if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
    clearPrependAnchor()
    if (prependAnchorFrame !== undefined) cancelAnimationFrame(prependAnchorFrame)
    virtualizer.scrollToEnd()
  }

  let measuredSessionKey = sessionKey()
  createEffect(() => {
    const key = sessionKey()
    timelineRows().length
    if (measuredSessionKey !== key) {
      measuredSessionKey = key
      virtualizer.measure()
    }
    maybeAnchorBottom()
  })

  onCleanup(() => {
    clearPrependAnchor()
    timelineCache.delete(ownerSessionKey)
    timelineCache.set(ownerSessionKey, { measurements: virtualizer.takeSnapshot(), toolOpen: { ...toolOpen } })
    while (timelineCache.size > 16) timelineCache.delete(timelineCache.keys().next().value!)
    if (resizePinFrame !== undefined) cancelAnimationFrame(resizePinFrame)
    if (overscanFrame !== undefined) cancelAnimationFrame(overscanFrame)
    props.setRevealMessage?.(() => {})
    props.setScrollToEnd?.(() => {})
    props.setHistoryAnchor?.({ capture: () => {}, restore: () => {} })
  })

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
  })
  let titleRef: HTMLInputElement | undefined

  const bindListRoot = (root: HTMLDivElement) => {
    if (root === listRoot()) return
    setListRoot(root)
    props.setScrollRef(root)
  }

  const handleListWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    if (!prependLoading) clearPrependAnchor()
    const root = event.currentTarget
    const delta = normalizeWheelDelta({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      rootHeight: root.clientHeight,
    })
    if (!delta) return
    markBoundaryGesture({ root, target: event.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
  }

  const handleListTouchStart = (event: TouchEvent) => {
    if (!prependLoading) clearPrependAnchor()
    touchGesture = event.touches[0]?.clientY
  }

  const handleListTouchMove = (event: TouchEvent & { currentTarget: HTMLDivElement }) => {
    const next = event.touches[0]?.clientY
    const prev = touchGesture
    touchGesture = next
    if (next === undefined || prev === undefined) return

    const delta = prev - next
    if (!delta) return

    markBoundaryGesture({
      root: event.currentTarget,
      target: event.target,
      delta,
      onMarkScrollGesture: props.onMarkScrollGesture,
    })
  }

  const handleListTouchEnd = () => {
    touchGesture = undefined
  }

  const handleListPointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!prependLoading) clearPrependAnchor()
    props.onMarkScrollGesture(event.target)
  }

  const handleListPointerMove = (event: PointerEvent) => {
    if (event.buttons !== 1) return
    props.onMarkScrollGesture(event.target)
  }

  const handleListKeyDown = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const key = scrollKey(event)
    if (!key) return
    if (!isScrollKeyTarget(event.target, key)) return
    if (scrollKeyOwner(event.currentTarget, event.target, key) !== event.currentTarget) return
    if (!prependLoading) clearPrependAnchor()
    props.onMarkScrollGesture(event.currentTarget)
  }

  const handleListScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (prependLoading) updatePrependAnchor()
    props.onScheduleScrollState(event.currentTarget)
    props.onHistoryScroll()
    if (!props.hasScrollGesture()) return
    props.onUserScroll()
    props.onAutoScrollHandleScroll()
    props.onMarkScrollGesture(event.currentTarget)
  }

  onCleanup(() => {
    props.setScrollRef(undefined)
  })

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const titleMutation = useMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      sdk().api.session.rename({ sessionID: input.id, title: input.title }),
    onSuccess: (_, input) => {
      sync().set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === input.id)
          if (index !== -1) draft.session[index].title = input.title
        }),
      )
      setTitle("editing", false)
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err),
      })
    },
  }))

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
        }),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description) return
        if (sync().data.message[id] !== undefined) return
        void sync().session.sync(id)
      },
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      if (!titleRef) return
      titleRef.focus()
      titleRef.select()
    })
  }

  const closeTitleEditor = () => {
    if (titleMutation.isPending) return
    setTitle("editing", false)
  }

  const saveTitleEditor = () => {
    const id = sessionID()
    if (!id) return
    if (titleMutation.isPending) return

    const next = title.draft.trim()
    if (!next || next === (titleLabel() ?? "")) {
      setTitle("editing", false)
      return
    }

    titleMutation.mutate({ id, title: next })
  }

  const exportSession = async (sessionID: string) => {
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
      })
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync().session.get(sessionID)
    if (!session) return false

    const sessions = (sync().data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk()
      .api.session.remove({ sessionID })
      .then(() => true)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    const removed = new Set<string>([sessionID])
    const byParent = new Map<string, string[]>()
    for (const item of sync().data.session) {
      const parentID = item.parentID
      if (!parentID) continue
      const existing = byParent.get(parentID)
      if (existing) {
        existing.push(item.id)
        continue
      }
      byParent.set(parentID, [item.id])
    }

    const stack = [sessionID]
    while (stack.length) {
      const parentID = stack.pop()
      if (!parentID) continue

      const children = byParent.get(parentID)
      if (!children) continue

      for (const child of children) {
        if (removed.has(child)) continue
        removed.add(child)
        stack.push(child)
      }
    }

    sessionArchive.navigateAfterRemoval(sessionID, session.parentID, nextSession?.id)

    sync().set(
      produce((draft) => {
        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    for (const id of removed) {
      sync().session.evict(id)
    }
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    navigate(
      sessionHref(params.serverKey ? requireServerKey(params.serverKey) : ServerConnection.key(serverSDK().server), id),
    )
  }

  function DialogDeleteSession(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(sync().session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const handleDelete = async () => {
      await deleteSession(props.sessionID)
      dialog.close()
    }

    return (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 variant="danger" onClick={handleDelete}>
            {language.t("session.delete.button")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    )
  }

  const workingTurn = (userMessageID: string) => sessionStatus().type !== "idle" && activeMessageID() === userMessageID

  const userMessageCreated = (userMessageID: string) => {
    const message = messageByID().get(userMessageID)
    return message?.role === "user" ? message.time.created : undefined
  }

  const turnDurationMs = (userMessageID: string) => {
    const message = messageByID().get(userMessageID)
    if (!message || message.role !== "user") return
    const end = (assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages).reduce<number | undefined>(
      (max, item) => {
        const completed = item.time.completed
        if (typeof completed !== "number") return max
        if (max === undefined) return completed
        return Math.max(max, completed)
      },
      undefined,
    )
    if (typeof end !== "number") return
    if (end < message.time.created) return
    return end - message.time.created
  }

  const assistantCopyPartID = (userMessageID: string) => {
    if (workingTurn(userMessageID)) return null
    const messages = assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = getMsgParts(message.id)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }
  }

  const renderAssistantPartGroup = (row: Accessor<TimelineRowMap["AssistantPart"]>, onSizeChange?: () => void) => {
    const groupType = createMemo(() => row().group.type)
    const groupParts = createMemo(() => {
      const group = row().group
      if (group.type === "part") return emptyTools
      return group.refs
        .map((ref) => getMsgPart(ref.messageID, ref.partID))
        .filter((part): part is ToolPart => part?.type === "tool")
    })
    const groupOpenKey = () => `context:${row().group.key}`

    const renderPart = (part: PartType, message: MessageType) => {
      const defaultOpen = () =>
        partDefaultOpen(part, settings.general.shellToolPartsExpanded(), settings.general.editToolPartsExpanded())
      return (
        <MessagePart
          part={part}
          message={message}
          showAssistantCopyPartID={assistantCopyPartID(row().userMessageID)}
          turnDurationMs={turnDurationMs(row().userMessageID)}
          useV2Actions
          defaultOpen={defaultOpen()}
          toolOpen={toolOpen[part.id] ?? defaultOpen()}
          onToolOpenChange={(open) => setToolOpen(part.id, open)}
          deferToolContent
          virtualizeDiff={false}
          onContentRendered={onSizeChange}
        />
      )
    }

    const message = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return messageByID().get(group.ref.messageID)
    })
    const part = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return getMsgPart(group.ref.messageID, group.ref.partID)
    })

    return (
      <Switch>
        <Match when={groupType() === "context"}>
          <ContextToolGroup
            parts={groupParts()}
            open={toolOpen[groupOpenKey()] === true}
            onOpenChange={(value) => setToolOpen(groupOpenKey(), value)}
            busy={
              workingTurn(row().userMessageID) && lastAssistantGroupKey().get(row().userMessageID) === row().group.key
            }
            onSizeChange={onSizeChange}
          />
        </Match>
        <Match when={groupType() === "tools"}>
          <ToolGroup
            parts={groupParts()}
            open={toolOpen[groupOpenKey()] === true}
            onOpenChange={(value) => setToolOpen(groupOpenKey(), value)}
            onSizeChange={onSizeChange}
          >
            {(item) => <Show when={messageByID().get(item.messageID)}>{(message) => renderPart(item, message())}</Show>}
          </ToolGroup>
        </Match>
        <Match when={groupType() === "part"}>
          <Show when={message()}>
            {(message) => <Show when={part()}>{(part) => renderPart(part(), message())}</Show>}
          </Show>
        </Match>
      </Switch>
    )
  }

  function TimelineRowFrame(input: { row: Accessor<FramedTimelineRow>; children: JSX.Element }) {
    const anchor = () => {
      const row = input.row()
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousAssistantPart = () => {
      const row = input.row()
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        id={anchor() ? props.anchor(input.row().userMessageID) : undefined}
        data-message-id={input.row().userMessageID}
        data-timeline-row={input.row()._tag}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": props.centered,
          "md:mx-auto": props.centered,
          "pt-3": previousAssistantPart(),
        }}
      >
        <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
          {input.children}
        </div>
      </div>
    )
  }

  const renderTimelineRow = (row: Accessor<TimelineRow.TimelineRow>, onSizeChange?: () => void) => {
    switch (row()._tag) {
      case "TurnGap":
        return <div data-timeline-row="TurnGap" aria-hidden="true" class="h-6" />
      case "CommentStrip": {
        const commentStripRow = row as Accessor<TimelineRowByTag<"CommentStrip">>
        const comments = createMemo(() =>
          getMsgParts(commentStripRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? []),
        )
        return (
          <TimelineRowFrame row={commentStripRow}>
            <div class="w-full px-4 md:px-5 pb-2">
              <div class="ms-auto max-w-[82%] overflow-x-auto no-scrollbar">
                <div class="flex w-max min-w-full justify-end gap-2">
                  <Index each={comments()}>
                    {(comment) => (
                      <div class="shrink-0 max-w-[260px] rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2">
                        <div class="flex items-center gap-1.5 min-w-0 text-[11px] text-v2-text-text-base [font-weight:530]">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-v2-text-text-muted">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-[12.5px] leading-5 text-v2-text-text-base whitespace-pre-wrap break-words">
                          {comment().comment}
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "UserMessage": {
        const userMessageRow = row as Accessor<TimelineRowByTag<"UserMessage">>
        const message = createMemo(() => {
          const m = messageByID().get(userMessageRow().userMessageID)
          if (m?.role === "user") return m
        })
        const messageComments = createMemo(() => {
          return getMsgParts(userMessageRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? [])
        })
        return (
          <TimelineRowFrame row={userMessageRow}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <Message
                      message={message()}
                      parts={getMsgParts(userMessageRow().userMessageID)}
                      actions={props.actions}
                      useV2Actions
                      comments={messageComments()}
                    />
                  </div>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "TurnDivider": {
        const turnDividerRow = row as Accessor<TimelineRowByTag<"TurnDivider">>
        return (
          <TimelineRowFrame row={turnDividerRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-compaction">
                <MessageDivider
                  label={language.t(
                    turnDividerRow().label === "compaction" ? "ui.messagePart.compaction" : "ui.message.interrupted",
                  )}
                />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
        return (
          <TimelineRowFrame row={assistantPartRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div
                data-slot="session-turn-assistant-content"
                aria-hidden={workingTurn(assistantPartRow().userMessageID)}
              >
                {renderAssistantPartGroup(assistantPartRow, onSizeChange)}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "TurnSteps": {
        const turnStepsRow = row as Accessor<TimelineRowByTag<"TurnSteps">>
        const parts = createMemo(() =>
          turnStepsRow().tools.flatMap((ref) => {
            const part = getMsgPart(ref.messageID, ref.partID)
            return part ? [part] : []
          }),
        )
        return (
          <TimelineRowFrame row={turnStepsRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 pb-2 md:px-5">
              <TurnStepsSummary
                parts={parts()}
                working={workingTurn(turnStepsRow().userMessageID)}
                startedAt={userMessageCreated(turnStepsRow().userMessageID)}
                durationMs={turnDurationMs(turnStepsRow().userMessageID)}
                open={turnStepsOpen(turnStepsRow())}
                onOpenSubagent={
                  data.openSubagent
                    ? (part) => data.openSubagent?.({ sessionID: part.sessionID, partID: part.id })
                    : undefined
                }
                onToggle={(open) => {
                  setToolOpen(`turn:${turnStepsRow().userMessageID}:${turnStepsRow().segment}`, open)
                  onSizeChange?.()
                }}
              />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Thinking": {
        const thinkingRow = row as Accessor<TimelineRowByTag<"Thinking">>
        return (
          <TimelineRowFrame row={thinkingRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineThinkingRow
                reasoningHeading={thinkingRow().reasoningHeading}
                showReasoningSummaries={settings.general.showReasoningSummaries()}
              />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Retry": {
        const retryRow = row as Accessor<TimelineRowByTag<"Retry">>
        return (
          <TimelineRowFrame row={retryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <SessionRetry status={sessionStatus()} show={activeMessageID() === retryRow().userMessageID} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "DiffSummary": {
        const diffSummaryRow = row as Accessor<TimelineRowByTag<"DiffSummary">>
        return (
          <TimelineRowFrame row={diffSummaryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineDiffSummaryRow diffs={diffSummaryRow().diffs} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        return (
          <TimelineRowFrame row={errorRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div
                role="alert"
                class="rounded-[16px] bg-v2-state-bg-danger px-4 py-2.5 text-[13px] leading-5 text-v2-state-fg-danger whitespace-pre-wrap break-words"
              >
                {errorRow().text}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
    }
  }

  function TimelineRowView(props: { row: TimelineRow.TimelineRow; onSizeChange?: () => void }) {
    return renderTimelineRow(() => props.row, props.onSizeChange)
  }

  function VirtualTimelineRow(props: { rowKey: string }) {
    let element: HTMLDivElement
    const initialItem = virtualItemByKey().get(props.rowKey)!
    const initialRow = timelineRowByKey().get(props.rowKey)!
    const item = createMemo(() => virtualItemByKey().get(props.rowKey) ?? initialItem)
    const row = createMemo(() => timelineRowByKey().get(props.rowKey) ?? initialRow)
    const tool = () => {
      const value = row()
      if (value._tag !== "AssistantPart" || value.group.type !== "part") return
      const part = getMsgPart(value.group.ref.messageID, value.group.ref.partID)
      if (part?.type === "tool") return part
    }
    const asyncFile = () => ["edit", "write", "apply_patch"].includes(tool()?.tool ?? "")
    const [ready, setReady] = createSignal(initialItem.size <= timelineFallbackItemSize || !asyncFile())
    let contentMeasureFrame: number | undefined

    onMount(() => virtualizer.measureElement(element))

    createEffect(
      on(
        () => item().index,
        () => {
          virtualizer.measureElement(element)
        },
        { defer: true },
      ),
    )

    onCleanup(() => {
      if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
    })

    return (
      <div
        data-timeline-key={props.rowKey}
        style={{
          position: "absolute",
          top: `${item().start - (showHeader() ? 64 : 0)}px`,
          left: "0",
          width: "100%",
          height: `${item().size}px`,
          overflow: "clip",
          // Rounded virtual measurements can otherwise clip a framed row's outer paint.
          "overflow-clip-margin": row()._tag === "TurnGap" ? undefined : "0.5px",
        }}
      >
        <div
          ref={(value) => {
            element = value
          }}
          data-index={item().index}
          style={{ "min-height": ready() ? undefined : `${initialItem.size}px` }}
        >
          <TimelineRowView
            row={row()}
            onSizeChange={() => {
              setReady(true)
              if (contentMeasureFrame !== undefined) cancelAnimationFrame(contentMeasureFrame)
              contentMeasureFrame = scheduleConnectedMeasure(element, virtualizer.measureElement)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div class="relative w-full h-full min-w-0">
      <div
        class="absolute left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-all duration-300 ease-emphasized bottom-8 motion-reduce:transition-none"
        classList={{
          "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
          "opacity-0 translate-y-2 pointer-events-none": !props.scroll.overflow || !props.scroll.jump,
          "scale-[0.8]": !props.scroll.overflow || !props.scroll.jump,
        }}
      >
        <button
          type="button"
          aria-label={language.t("session.messages.jumpToLatest")}
          class="pointer-events-auto flex items-center justify-center size-9 rounded-full border-none cursor-pointer text-v2-text-text-base backdrop-blur-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
          style={{
            background: "color-mix(in srgb, var(--v2-background-bg-base) 92%, transparent)",
            "box-shadow": "0 0 0 0.5px var(--v2-border-border-muted), 0 6px 16px -8px rgb(0 0 0 / 0.2)",
          }}
          onClick={props.onResumeScroll}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M12.3333 8.66665L8 13L3.66667 8.66665M8 12.6667V2.83332"
              stroke="currentColor"
              stroke-linecap="square"
            />
          </svg>
        </button>
      </div>
      <ScrollView
        viewportRef={bindListRoot}
        onWheel={handleListWheel}
        onTouchStart={handleListTouchStart}
        onTouchMove={handleListTouchMove}
        onTouchEnd={handleListTouchEnd}
        onTouchCancel={handleListTouchEnd}
        onPointerDown={handleListPointerDown}
        onPointerMove={handleListPointerMove}
        onKeyDown={handleListKeyDown}
        onScroll={handleListScroll}
        onClick={props.onAutoScrollInteraction}
        class="relative min-w-0 w-full h-full"
        style={{
          "--sticky-accordion-top": showHeader() ? "48px" : "0px",
        }}
      >
        <Show when={showHeader()}>
          <div
            data-session-title
            class="sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_48px,transparent)] w-full pb-4 pr-3 pl-2.5"
          >
            <div class="h-12 w-full flex items-center justify-between gap-2">
              <div
                classList={{
                  "flex items-center gap-1 min-w-0 flex-1": true,
                }}
              >
                <div class="flex items-center min-w-0 flex-1 w-full">
                  <Show when={parentID()}>
                    <button
                      type="button"
                      data-slot="session-title-parent"
                      class="min-w-0 max-w-[40%] truncate pl-3 text-[14px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-faint transition-colors duration-150 ease-standard hover:text-v2-text-text-muted motion-reduce:transition-none"
                      onClick={navigateParent}
                    >
                      {parentTitle()}
                    </button>
                    <span
                      data-slot="session-title-separator"
                      class="-translate-y-[0.5px] pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  </Show>
                  <Show when={childTitle() || title.editing}>
                    <Show
                      when={title.editing}
                      fallback={
                        <h1
                          data-slot="session-title-child"
                          class="truncate text-[14px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base w-fit rounded-full px-3 py-1 transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover motion-reduce:transition-none"
                          onClick={openTitleEditor}
                        >
                          {childTitle()}
                        </h1>
                      }
                    >
                      <InlineInput
                        ref={(el) => {
                          titleRef = el
                        }}
                        data-slot="session-title-child"
                        value={title.draft}
                        disabled={titleMutation.isPending}
                        class="block text-[14px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base field-sizing-content self-start rounded-full px-3 py-1"
                        style={{
                          "--inline-input-shadow": "none",
                        }}
                        onInput={(event) => setTitle("draft", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === "Enter") {
                            event.preventDefault()
                            void saveTitleEditor()
                            return
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            closeTitleEditor()
                          }
                        }}
                        onBlur={closeTitleEditor}
                      />
                    </Show>
                  </Show>
                </div>
              </div>
              <Show when={sessionID()} keyed>
                {(id) => (
                  <div class="shrink-0 flex items-center gap-1">
                    <Show when={changes()}>
                      {(summary) => (
                        <button
                          type="button"
                          data-action="session-changes"
                          class="hidden md:flex h-7 items-center rounded-full px-2.5 transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                          aria-label={`${language.t("session.review.change.other")} +${summary().additions} -${summary().deletions}`}
                          aria-expanded={sessionView().reviewPanel.opened()}
                          aria-controls="review-panel"
                          onClick={() => sessionView().reviewPanel.toggle()}
                        >
                          <DiffChanges changes={summary()} />
                        </button>
                      )}
                    </Show>
                    <Show when={!parentID()}>
                      <MenuV2
                        gutter={6}
                        placement="bottom-end"
                        open={title.menuOpen}
                        onOpenChange={(open) => {
                          setTitle("menuOpen", open)
                          if (open) return
                        }}
                      >
                        <MenuV2.Trigger
                          as={IconButtonV2}
                          icon={<IconV2 name="outline-dots" />}
                          variant="ghost-muted"
                          size="large"
                          aria-label={language.t("common.moreOptions")}
                          aria-expanded={title.menuOpen}
                        />
                        <MenuV2.Portal>
                          <MenuV2.Content
                            style={{ width: "120px", "min-width": "120px" }}
                            onCloseAutoFocus={(event) => {
                              if (title.pendingRename) {
                                event.preventDefault()
                                setTitle("pendingRename", false)
                                openTitleEditor()
                              }
                            }}
                          >
                            <MenuV2.Item
                              onSelect={() => {
                                setTitle("pendingRename", true)
                                setTitle("menuOpen", false)
                              }}
                            >
                              {language.t("common.rename")}
                            </MenuV2.Item>
                            <MenuV2.Item onSelect={() => exportSession(id)}>
                              {language.t("common.export")}...
                            </MenuV2.Item>
                            <MenuV2.Item onSelect={() => void sessionArchive.archive(id)}>
                              {language.t("common.archive")}
                            </MenuV2.Item>
                            <MenuV2.Separator />
                            <MenuV2.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} />)}>
                              {language.t("common.delete")}...
                            </MenuV2.Item>
                          </MenuV2.Content>
                        </MenuV2.Portal>
                      </MenuV2>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>
        <div
          data-timeline-virtual-content
          ref={(element) => {
            virtualContent = element
            props.setContentRef(element)
          }}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          <For each={virtualRowKeys()}>{(rowKey) => <VirtualTimelineRow rowKey={rowKey} />}</For>
          <Show when={timelineRows().length > 0}>
            <div
              data-timeline-row="bottom-spacer"
              aria-hidden="true"
              class="h-16 absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualizer.getTotalSize() - 64}px)` }}
            />
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
