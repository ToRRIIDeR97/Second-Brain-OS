import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, ComponentProps, createEffect, createMemo, createSelector, For, JSX, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createVirtualizer } from "@tanstack/solid-virtual"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders } from "@/hooks/use-providers"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { List } from "@opencode-ai/ui/list"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { handleDocumentSearchKeydown } from "@/utils/search-keydown"
import { createMenuDismissController } from "@/utils/menu-dismiss-controller"
import { createEventListener } from "@solid-primitives/event-listener"
import { matchesModelSearch } from "./dialog-select-model-search"
import { activeOverlayClass, listV2Class, menuItemsClass, searchFieldClass } from "./surface-classes"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ModelState = ReturnType<typeof useLocal>["model"]
type ModelItem = ReturnType<ModelState["list"]>[number]

const modelKey = (model: ModelItem) => `${model.provider.id}:${model.id}`
const manageKey = "action:manage"

const sortModelGroups = (a: { category: string; items: ModelItem[] }, b: { category: string; items: ModelItem[] }) => {
  const aIndex = popularProviders.indexOf(a.category)
  const bIndex = popularProviders.indexOf(b.category)
  const aPopular = aIndex >= 0
  const bPopular = bIndex >= 0

  if (aPopular && !bPopular) return -1
  if (!aPopular && bPopular) return 1
  if (aPopular && bPopular) return aIndex - bIndex
  return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
}

const ModelList: Component<{
  provider?: string
  onSelect: () => void
  model?: ModelState
}> = (props) => {
  const model = props.model ?? useLocal().model
  const language = useLanguage()

  const models = createMemo(() =>
    model
      .list()
      .filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true)),
  )

  return (
    <List
      class={`flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${listV2Class}`}
      search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      current={model.current()}
      filterKeys={["provider.name", "name", "id"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      groupBy={(x) => x.provider.name}
      sortGroupsBy={(a, b) => {
        const aProvider = a.items[0].provider.id
        const bProvider = b.items[0].provider.id
        if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
        if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
      }}
      itemWrapper={(item, node) => (
        <TooltipV2
          class="w-full"
          placement="right-start"
          gutter={12}
          openDelay={0}
          value={<ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} />}
        >
          {node}
        </TooltipV2>
      )}
      onSelect={(x) => {
        model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
          recent: true,
        })
        props.onSelect()
      }}
    >
      {(i) => (
        <div class="flex w-full items-center gap-x-2 text-[13px]">
          <span class="truncate">{i.name}</span>
          <Show when={isFree(i.provider.id, i.cost)}>
            <Tag>{language.t("model.tag.free")}</Tag>
          </Show>
          <Show when={i.latest}>
            <Tag>{language.t("model.tag.latest")}</Tag>
          </Show>
        </div>
      )}
    </List>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">
type ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => JSX.Element
export function ModelSelectorPopoverV2(props: {
  provider?: string
  model?: ModelState
  trigger: ModelSelectorTrigger
  onClose?: () => void
}) {
  const dialog = useDialog()
  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => props.onClose?.(),
  })

  return (
    <ModelSelectorPopoverV2View
      trigger={props.trigger}
      models={controller.models}
      groups={controller.groups}
      current={controller.current}
      select={controller.select}
      onManage={() => {
        void import("./dialog-manage-models").then((module) => {
          void dialog.show(() => <module.DialogManageModelsV2 />)
        })
      }}
      onClose={() => props.onClose?.()}
    />
  )
}

function createModelSelectorController(input: {
  provider: () => string | undefined
  model?: ModelState
  onSelect: () => void
}) {
  const model = input.model ?? useLocal().model
  const allModels = createMemo(() =>
    model
      .list()
      .filter((item) => model.visible({ modelID: item.id, providerID: item.provider.id }))
      .filter((item) => (input.provider() ? item.provider.id === input.provider() : true)),
  )

  return {
    models: (search: string) => {
      const query = search.trim()
      const filtered = query
        ? allModels().filter((item) => matchesModelSearch(query, [item.name, item.id, item.provider.name]))
        : allModels()
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    },
    groups: (models: ModelItem[]) => {
      const byProvider = new Map<string, ModelItem[]>()
      for (const item of models) {
        byProvider.set(item.provider.id, [...(byProvider.get(item.provider.id) ?? []), item])
      }
      return Array.from(byProvider, ([category, items]) => ({ category, items })).sort(sortModelGroups)
    },
    current: createMemo(() => {
      const value = model.current()
      return value ? modelKey(value) : undefined
    }),
    select: (item: ModelItem) => {
      model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })
      input.onSelect()
    },
  }
}

function ModelSelectorPopoverV2View(props: {
  trigger: ModelSelectorTrigger
  models: (search: string) => ModelItem[]
  groups: (models: ModelItem[]) => { category: string; items: ModelItem[] }[]
  current: () => string | undefined
  select: (item: ModelItem) => void
  onManage: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    open: false,
    search: "",
    active: "",
    viewport: undefined as HTMLDivElement | undefined,
  })
  let searchRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined
  const dismiss = createMenuDismissController(() => contentRef)

  const models = createMemo(() => props.models(store.search))
  const groups = createMemo(() => props.groups(models()))
  const active = createSelector(() => store.active)
  // ponytail: virtualize whole providers to retain sticky labels; split rows if a single provider becomes too large.
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return groups().length
    },
    get enabled() {
      return store.open
    },
    getScrollElement: () => store.viewport ?? null,
    initialRect: { width: 300, height: 320 },
    get estimateSize() {
      const current = groups()
      // Group label is 28px; each item is 36px (menuItemsClass) plus the 2px group gap.
      return (index: number) => 28 + current[index].items.length * 38
    },
    get getItemKey() {
      const current = groups()
      return (index: number) => current[index].category
    },
    overscan: 1,
  })
  const visibleGroups = createMemo(() => new Map(virtualizer.getVirtualItems().map((item) => [item.index, item])))
  const keys = createMemo(() => [...groups().flatMap((group) => group.items.map(modelKey)), manageKey])
  const initialActive = () => {
    const selected = props.current()
    const options = keys()
    if (selected && options.includes(selected)) return selected
    return options[0] ?? ""
  }
  const activeItem = () =>
    store.active ? contentRef?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`) : undefined
  const scrollActive = () => {
    const index = groups().findIndex((group) => group.items.some((item) => modelKey(item) === store.active))
    if (index >= 0 && !visibleGroups().has(index)) virtualizer.scrollToIndex(index, { align: "start" })
    requestAnimationFrame(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }
  const setOpen = (open: boolean) => {
    if (open) {
      dismiss.allowTriggerRestore()
      setStore({ open: true, active: initialActive() })
      setTimeout(() =>
        requestAnimationFrame(() => {
          searchRef?.focus()
          scrollActive()
        }),
      )
      return
    }
    setStore({ open: false, search: "", active: "" })
  }
  const selectModel = (item: ModelItem) => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(() => props.select(item))
  }
  const manage = () => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(props.onManage)
  }
  const selectActive = () => {
    const item = models().find((item) => modelKey(item) === store.active)
    if (item) {
      selectModel(item)
      return
    }
    if (store.active === manageKey) manage()
  }
  const moveActive = (delta: number) => {
    const options = keys()
    if (options.length === 0) return
    const index = options.indexOf(store.active)
    const start = index === -1 ? 0 : index
    setStore("active", options[(start + delta + options.length) % options.length])
    queueMicrotask(scrollActive)
  }
  const setSearch = (value: string) => {
    const first = props.models(value)[0]
    setStore({ search: value, active: first ? modelKey(first) : manageKey })
    queueMicrotask(scrollActive)
  }

  createEffect(() => {
    if (!store.open) return
    createEventListener(
      document,
      "keydown",
      (event: KeyboardEvent) => handleDocumentSearchKeydown(searchRef, event, store.search, setSearch),
      true,
    )
  })

  return (
    <MenuV2 open={store.open} modal={false} placement="top-start" gutter={6} onOpenChange={setOpen}>
      <MenuV2.Trigger as={props.trigger} />
      <MenuV2.Portal>
        <MenuV2.Content
          ref={(element: HTMLDivElement) => (contentRef = element)}
          class={`w-[300px] overflow-hidden !rounded-[24px] border-0 bg-v2-background-bg-layer-01 !p-0 shadow-[var(--v2-elevation-floating)] focus:outline-none ${menuItemsClass}`}
          onPointerDownOutside={dismiss.preventTriggerRestore}
          onFocusOutside={dismiss.preventTriggerRestore}
          onCloseAutoFocus={dismiss.onCloseAutoFocus}
        >
          <div class="flex flex-col px-2 pt-2 pb-1.5">
            <div class="relative flex items-center text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" class="pointer-events-none absolute left-3 shrink-0" />
              <input
                ref={(el) => (searchRef = el)}
                value={store.search}
                placeholder={language.t("dialog.model.search.placeholder")}
                aria-label={language.t("dialog.model.search.placeholder")}
                class={`${searchFieldClass} pr-9`}
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                onInput={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Tab") return
                  event.stopPropagation()
                  if (event.key === "Escape") {
                    event.preventDefault()
                    dismiss.preventTriggerRestore()
                    setOpen(false)
                    dismiss.afterClose(props.onClose)
                    return
                  }
                  if (event.altKey || event.metaKey) return
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    moveActive(1)
                    return
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    moveActive(-1)
                    return
                  }
                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault()
                    selectActive()
                  }
                }}
              />
              <Show when={store.search.trim()}>
                <button
                  type="button"
                  class="absolute right-2 flex size-6 items-center justify-center rounded-full text-v2-icon-icon-muted transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setSearch("")}
                  aria-label={language.t("common.clear")}
                >
                  <Icon name="close" size="small" />
                </button>
              </Show>
            </div>
          </div>
          <ScrollView
            data-slot="model-selector-scroll"
            class="max-h-[320px] min-h-0"
            viewportRef={(element) => setStore("viewport", element)}
          >
            <div class="relative" style={{ height: `${models().length ? virtualizer.getTotalSize() : 48}px` }}>
              <Show
                when={models().length > 0}
                fallback={
                  <div class="flex h-12 items-center px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
                    {language.t("dialog.model.empty")}
                  </div>
                }
              >
                <For each={groups()}>
                  {(group, index) => (
                    <Show when={visibleGroups().get(index())}>
                      {(row) => (
                        <MenuV2.Group
                          class="absolute inset-x-2 flex flex-col gap-0.5"
                          style={{ top: `${row().start}px` }}
                        >
                          <MenuV2.GroupLabel class="sticky top-0 z-10 gap-2 bg-v2-background-bg-layer-01 px-3">
                            <span class="min-w-0 truncate">{group.items[0].provider.name}</span>
                          </MenuV2.GroupLabel>
                          <MenuV2.RadioGroup value={props.current()}>
                            <For each={group.items}>
                              {(item) => (
                                <TooltipV2
                                  class="w-full"
                                  placement="right-start"
                                  gutter={6}
                                  openDelay={0}
                                  value={
                                    <ModelTooltip
                                      model={item}
                                      latest={item.latest}
                                      free={isFree(item.provider.id, item.cost)}
                                    />
                                  }
                                >
                                  <MenuV2.RadioItem
                                    value={modelKey(item)}
                                    data-option-key={modelKey(item)}
                                    data-selected-model={props.current() === modelKey(item) ? true : undefined}
                                    class="scroll-my-6 w-full"
                                    classList={{ [activeOverlayClass]: active(modelKey(item)) }}
                                    onMouseEnter={() => {
                                      setStore("active", modelKey(item))
                                      setTimeout(() => searchRef?.focus())
                                    }}
                                    onSelect={() => selectModel(item)}
                                  >
                                    <span class="min-w-0 truncate leading-5">{item.name}</span>
                                    <Show when={isFree(item.provider.id, item.cost)}>
                                      <Tag class="shrink-0">{language.t("model.tag.free")}</Tag>
                                    </Show>
                                    <Show when={item.latest}>
                                      <Tag class="shrink-0">{language.t("model.tag.latest")}</Tag>
                                    </Show>
                                  </MenuV2.RadioItem>
                                </TooltipV2>
                              )}
                            </For>
                          </MenuV2.RadioGroup>
                        </MenuV2.Group>
                      )}
                    </Show>
                  )}
                </For>
              </Show>
            </div>
          </ScrollView>
          <div class="mx-4 h-px bg-v2-border-border-muted" />
          <div class="flex flex-col p-2">
            <MenuV2.Item
              data-option-key={manageKey}
              classList={{ [activeOverlayClass]: active(manageKey) }}
              onMouseEnter={() => {
                setStore("active", manageKey)
                setTimeout(() => searchRef?.focus())
              }}
              onSelect={manage}
            >
              <Icon name="outline-sliders" size="small" />
              <span class="min-w-0 flex-1 truncate leading-5">{language.t("dialog.model.manage")}</span>
            </MenuV2.Item>
          </div>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const directory = () => decode64(local.slug())

  const provider = () => {
    void import("./dialog-connect-provider").then((x) => {
      void dialog.show(() => <x.DialogConnectProvider directory={directory} />)
    })
  }

  const manage = () => {
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModelsV2 />)
    })
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{language.t("dialog.model.select.title")}</DialogTitle>
        <ButtonV2 size="small" variant="ghost" icon="plus" class="-my-1.5 me-2" tabIndex={-1} onClick={provider}>
          {language.t("command.provider.connect")}
        </ButtonV2>
      </DialogHeader>
      <DialogBody class="min-h-0">
        <ModelList provider={props.provider} model={props.model} onSelect={() => dialog.close()} />
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" icon="outline-sliders" onClick={manage}>
          {language.t("dialog.model.manage")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
