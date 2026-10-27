import { Tabs as Kobalte } from "@kobalte/core/tabs"
import { createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js"
import type { ComponentProps, ParentProps, Component } from "solid-js"
import { useI18n } from "../../context/i18n"
import "./tabs-v2.css"

export interface TabsV2Props extends ComponentProps<typeof Kobalte> {
  variant?: "normal" | "pill" | "settings"
  orientation?: "horizontal" | "vertical"
}
export interface TabsV2ListProps extends ComponentProps<typeof Kobalte.List> {}
export interface TabsV2TriggerProps extends ComponentProps<typeof Kobalte.Trigger> {
  onMiddleClick?: () => void
  /** Optional subtext shown beside the primary content (muted style) */
  subtext?: JSX.Element | string
}
export interface TabsV2CloseButtonProps extends ComponentProps<"div"> {}
export interface TabsV2ContentProps extends ComponentProps<typeof Kobalte.Content> {}

function TabsV2Root(props: TabsV2Props) {
  const [split, rest] = splitProps(props, ["class", "classList", "variant", "orientation"])
  return (
    <Kobalte
      {...rest}
      orientation={split.orientation}
      data-component="tabs-v2"
      data-variant={split.variant || "normal"}
      data-orientation={split.orientation || "horizontal"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

function TabsV2List(props: TabsV2ListProps) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  const [indicator, setIndicator] = createSignal<HTMLElement>()
  // The list is the indicator's parent, so a caller's `ref` on the list still reaches Kobalte untouched.
  const placed = createTabsIndicator(() => indicator()?.parentElement ?? undefined)
  return (
    <Kobalte.List
      {...rest}
      data-slot="tabs-v2-list"
      data-indicator={placed() ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <div ref={setIndicator} data-slot="tabs-v2-indicator" aria-hidden="true" />
      {split.children}
    </Kobalte.List>
  )
}

/**
 * The selected-tab highlight of the pill and settings variants slides between tabs: the list measures the
 * selected trigger and positions one indicator (`--tabs-v2-indicator-*`). The normal variant keeps its
 * static underline, because its tabs can be dragged to reorder and move by transform meanwhile. Returns
 * whether the indicator is placed; until then each selected tab draws its own highlight.
 */
function createTabsIndicator(list: () => HTMLElement | undefined) {
  const [placed, setPlaced] = createSignal(false)

  onMount(() => {
    const element = list()
    const variant = element?.closest<HTMLElement>('[data-component="tabs-v2"]')?.dataset.variant
    if (!element || (variant !== "pill" && variant !== "settings")) return
    if (typeof MutationObserver === "undefined" || typeof ResizeObserver === "undefined") return

    const measure = () => {
      const wrapper = element.querySelector<HTMLElement>('[data-slot="tabs-v2-trigger"][data-selected]')?.parentElement
      if (!wrapper || wrapper.offsetParent !== element) {
        setPlaced(false)
        return
      }
      element.style.setProperty("--tabs-v2-indicator-x", `${wrapper.offsetLeft}px`)
      element.style.setProperty("--tabs-v2-indicator-y", `${wrapper.offsetTop}px`)
      element.style.setProperty("--tabs-v2-indicator-width", `${wrapper.offsetWidth}px`)
      element.style.setProperty("--tabs-v2-indicator-height", `${wrapper.offsetHeight}px`)
      setPlaced(true)
    }

    const mutations = new MutationObserver(measure)
    mutations.observe(element, { subtree: true, childList: true, attributeFilter: ["data-selected"] })
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    measure()
    onCleanup(() => {
      mutations.disconnect()
      resize.disconnect()
    })
  })

  return placed
}

function TabsV2Trigger(props: ParentProps<TabsV2TriggerProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children", "onMiddleClick", "subtext"])
  return (
    <div
      data-slot="tabs-v2-trigger-wrapper"
      data-value={props.value}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      onMouseDown={(e) => {
        if (e.button === 1 && split.onMiddleClick) {
          e.preventDefault()
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && split.onMiddleClick) {
          e.preventDefault()
          split.onMiddleClick()
        }
      }}
    >
      <Kobalte.Trigger {...rest} data-slot="tabs-v2-trigger" data-value={props.value}>
        <span class="inline-flex items-center gap-2" data-slot="tabs-v2-trigger-content">
          {split.children}
          <Show when={split.subtext}>
            {(subtext) => (
              <span data-slot="tabs-v2-subtext" class="ms-2 text-xs text-text-weak">
                {subtext()}
              </span>
            )}
          </Show>
        </span>
      </Kobalte.Trigger>
    </div>
  )
}

function TabsV2CloseButton(props: TabsV2CloseButtonProps) {
  const i18n = useI18n()
  const [split, rest] = splitProps(props, ["class", "classList", "onClick"])
  return (
    <div
      role="button"
      tabindex={0}
      aria-label={i18n.t("ui.tabs.close")}
      data-slot="tabs-v2-close-button"
      {...rest}
      classList={{
        [split.class ?? ""]: !!split.class,
        ...split.classList,
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (typeof split.onClick === "function") {
          split.onClick(e)
        }
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.8889 3.11108L3.11108 10.8889" stroke="currentColor" stroke-linejoin="round" />
        <path d="M3.11108 3.11108L10.8889 10.8889" stroke="currentColor" stroke-linejoin="round" />
      </svg>
    </div>
  )
}

function TabsV2Content(props: ParentProps<TabsV2ContentProps>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Kobalte.Content
      {...rest}
      data-slot="tabs-v2-content"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </Kobalte.Content>
  )
}

const TabsV2SectionTitle: Component<ParentProps> = (props) => {
  return <div data-slot="tabs-v2-section-title">{props.children}</div>
}

export const TabsV2 = Object.assign(TabsV2Root, {
  List: TabsV2List,
  Trigger: TabsV2Trigger,
  CloseButton: TabsV2CloseButton,
  Content: TabsV2Content,
  SectionTitle: TabsV2SectionTitle,
})
