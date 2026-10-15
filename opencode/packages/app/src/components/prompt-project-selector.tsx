import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  type Accessor,
  type ComponentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { getProjectAvatarVariant } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"
import { handleDocumentSearchKeydown } from "@/utils/search-keydown"
import { createMenuDismissController } from "@/utils/menu-dismiss-controller"
import { activeOverlayClass, menuSurfaceClass, searchFieldClass } from "./surface-classes"

export type PromptProject = {
  name?: string
  id?: string
  worktree: string
  sandboxes?: string[]
  icon?: { color?: string; url?: string; override?: string }
  server?: { key: string; name: string }
}

export type PromptProjectControls = {
  available: PromptProject[]
  directory: string
  server?: string
  select: (worktree: string, server?: string) => void
  add: (title: string, server?: string) => void
}

const actionPrefix = "action:"
const projectPrefix = "project:"

function projectKey(project: PromptProject) {
  return `${projectPrefix}${encodeURIComponent(project.server?.key ?? "")}:${encodeURIComponent(project.worktree)}`
}

function actionKey(server?: string) {
  return `${actionPrefix}${encodeURIComponent(server ?? "")}`
}

export function createPromptProjectController(input: {
  controls: Accessor<PromptProjectControls>
  onDone: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ open: false, search: "", active: "" })
  let searchRef: HTMLInputElement | undefined

  const current = () => {
    const key = pathKey(input.controls().directory)
    return input
      .controls()
      .available.find(
        (project) =>
          (!project.server || project.server.key === input.controls().server) &&
          (pathKey(project.worktree) === key || project.sandboxes?.some((sandbox) => pathKey(sandbox) === key)),
      )
  }
  const selected = () => current() ?? input.controls().available[0]
  const projects = () => {
    const search = store.search.trim().toLowerCase()
    if (!search) return input.controls().available
    return input.controls().available.filter((project) => displayName(project).toLowerCase().includes(search))
  }
  const servers = () =>
    input
      .controls()
      .available.map((project) => project.server)
      .filter((server, index, all) => server && all.findIndex((item) => item?.key === server.key) === index)
  const keys = () => {
    if (servers().length <= 1) {
      return [...projects().map(projectKey), actionKey(servers()[0]?.key)]
    }
    return [
      ...servers().flatMap((server) =>
        projects()
          .filter((project) => project.server?.key === server!.key)
          .map(projectKey),
      ),
      actionKey(),
    ]
  }
  const initialActive = () => {
    const selectedKey = selected() ? projectKey(selected()!) : undefined
    const options = keys()
    if (selectedKey && options.includes(selectedKey)) return selectedKey
    return options[0] ?? ""
  }
  const close = () => {
    setStore({ open: false, search: "", active: "" })
    input.onDone()
  }
  const select = (project: PromptProject) => {
    if (
      pathKey(project.worktree) !== pathKey(current()?.worktree ?? "") ||
      project.server?.key !== current()?.server?.key
    ) {
      input.controls().select(project.worktree, project.server?.key)
    }
    close()
  }
  const add = (server?: string) => {
    setStore({ open: false, search: "", active: "" })
    input.controls().add(language.t("command.project.open"), server)
  }
  const setSearch = (value: string) => {
    const search = value.trim().toLowerCase()
    const first = input
      .controls()
      .available.find((project) => !search || displayName(project).toLowerCase().includes(search))
    setStore({
      search: value,
      active: first ? projectKey(first) : actionKey(servers().length > 1 ? undefined : servers()[0]?.key),
    })
  }

  return {
    selected,
    empty: () => input.controls().available.length === 0,
    projects,
    servers,
    projectKey,
    actionKey,
    open: () => store.open,
    search: () => store.search,
    active: () => store.active,
    labels: {
      add: () => language.t("session.new.project.add"),
      clear: () => language.t("common.clear"),
      new: () => language.t("session.new.project.new"),
      search: () => language.t("session.new.project.search"),
    },
    add,
    select,
    setOpen(open: boolean) {
      if (open) {
        setStore({ open: true, active: initialActive() })
        setTimeout(() => requestAnimationFrame(() => searchRef?.focus()))
        return
      }
      setStore({ open: false, search: "", active: "" })
    },
    setSearch,
    clearSearch() {
      setStore({ search: "", active: initialActive() })
      setTimeout(() => searchRef?.focus())
    },
    setActive(key: string) {
      setStore("active", key)
    },
    moveActive(delta: number) {
      const options = keys()
      if (options.length === 0) return
      const index = options.indexOf(store.active)
      const start = index === -1 ? 0 : index
      setStore("active", options[(start + delta + options.length) % options.length])
    },
    activeProject() {
      return store.active.startsWith(projectPrefix)
        ? projects().find((project) => projectKey(project) === store.active)
        : undefined
    },
    activeServer() {
      return store.active.startsWith(actionPrefix)
        ? decodeURIComponent(store.active.slice(actionPrefix.length)) || undefined
        : undefined
    },
    activeAction() {
      return store.active.startsWith(actionPrefix)
    },
    setSearchRef(el: HTMLInputElement) {
      searchRef = el
    },
    focusSearch() {
      setTimeout(() => requestAnimationFrame(() => searchRef?.focus()))
    },
    handleSearchKeydown(event: KeyboardEvent) {
      return handleDocumentSearchKeydown(searchRef, event, store.search, setSearch)
    },
  }
}

export type PromptProjectController = ReturnType<typeof createPromptProjectController>

export function PromptProjectSelector(props: {
  controller: PromptProjectController
  placement?: "bottom" | "bottom-start"
}) {
  const [triggerReady, setTriggerReady] = createSignal(false)
  let contentRef: HTMLDivElement | undefined
  const dismiss = createMenuDismissController(() => contentRef)
  let triggerFrame: number | undefined

  // Floating UI requires a connected anchor; route transitions can construct this trigger before adoption.
  const setTriggerRef = (element: HTMLButtonElement) => {
    const ready = () => {
      if (!element.isConnected) {
        triggerFrame = requestAnimationFrame(ready)
        return
      }
      triggerFrame = undefined
      setTriggerReady(true)
    }
    ready()
  }

  onCleanup(() => {
    if (triggerFrame !== undefined) cancelAnimationFrame(triggerFrame)
  })

  const activeItem = () =>
    props.controller.active()
      ? contentRef?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(props.controller.active())}"]`)
      : undefined
  const selectProject = (project: PromptProject) => {
    dismiss.preventTriggerRestore()
    props.controller.setOpen(false)
    dismiss.afterClose(() => props.controller.select(project))
  }
  const selectAction = (server?: string) => {
    dismiss.preventTriggerRestore()
    props.controller.setOpen(false)
    dismiss.afterClose(() => props.controller.add(server))
  }
  const selectActive = () => {
    const project = props.controller.activeProject()
    if (project) {
      selectProject(project)
      return
    }
    if (props.controller.activeAction() && props.controller.servers().length > 1) {
      const item = activeItem()
      item?.focus()
      item?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      return
    }
    selectAction(props.controller.activeServer())
  }
  const moveActive = (delta: number) => {
    props.controller.moveActive(delta)
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }
  const focusPreviousControl = () => {
    const target = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
      .filter((element) => !contentRef?.contains(element) && !element.hasAttribute("data-focus-trap"))
      .findLast((element) => element.offsetParent !== null)
    dismiss.preventTriggerRestore()
    target?.focus()
    queueMicrotask(() => {
      if (props.controller.open()) props.controller.setOpen(false)
    })
  }
  const selectedValue = () => {
    const project = props.controller.selected()
    return project ? props.controller.projectKey(project) : undefined
  }

  createEffect(() => {
    if (!props.controller.open()) return
    const handler = (event: KeyboardEvent) => props.controller.handleSearchKeydown(event)
    document.addEventListener("keydown", handler, true)
    onCleanup(() => document.removeEventListener("keydown", handler, true))
  })

  return (
    <MenuV2
      open={triggerReady() && props.controller.open()}
      placement={props.placement ?? "bottom"}
      gutter={4}
      modal={false}
      onOpenChange={(open) => {
        if (open) dismiss.allowTriggerRestore()
        props.controller.setOpen(open)
      }}
    >
      <MenuV2.Trigger as={ProjectTrigger} ref={setTriggerRef} controller={props.controller} />
      <MenuV2.Portal>
        <MenuV2.Content
          ref={contentRef}
          id="prompt-project-menu"
          class={`w-[280px] overflow-hidden border-0 focus:outline-none [&[data-closed]]:!animate-none ${menuSurfaceClass}`}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerDownOutside={dismiss.preventTriggerRestore}
          onFocusOutside={dismiss.preventTriggerRestore}
          onCloseAutoFocus={dismiss.onCloseAutoFocus}
        >
          <div class="relative flex items-center p-0.5 pb-1 text-v2-icon-icon-muted">
            <Icon name="magnifying-glass" size="small" class="pointer-events-none absolute left-3.5 shrink-0" />
            <input
              ref={(el) => props.controller.setSearchRef(el)}
              value={props.controller.search()}
              placeholder={props.controller.labels.search()}
              aria-label={props.controller.labels.search()}
              aria-autocomplete="list"
              aria-controls="prompt-project-menu"
              aria-activedescendant={props.controller.active() || undefined}
              class={`${searchFieldClass} pr-9`}
              onInput={(event) => props.controller.setSearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  event.preventDefault()
                  event.stopPropagation()
                  if (event.shiftKey) {
                    focusPreviousControl()
                    return
                  }
                  activeItem()?.focus()
                  return
                }
                event.stopPropagation()
                if (event.key === "Escape") {
                  event.preventDefault()
                  props.controller.setOpen(false)
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
            <Show when={props.controller.search().trim()}>
              <button
                type="button"
                class="absolute right-2 flex size-6 items-center justify-center rounded-full text-v2-icon-icon-muted transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => props.controller.clearSearch()}
                aria-label={props.controller.labels.clear()}
              >
                <Icon name="close" size="small" />
              </button>
            </Show>
          </div>
          <div class="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
            <Show
              when={props.controller.servers().length > 1}
              fallback={
                <MenuV2.RadioGroup value={selectedValue()} class="flex flex-col gap-0.5">
                  <For each={props.controller.projects()}>
                    {(project) => (
                      <ProjectItem project={project} controller={props.controller} onSelect={selectProject} />
                    )}
                  </For>
                </MenuV2.RadioGroup>
              }
            >
              <For
                each={props.controller
                  .servers()
                  .filter((server) =>
                    props.controller.projects().some((project) => project.server?.key === server!.key),
                  )}
              >
                {(server) => (
                  <MenuV2.Group>
                    <MenuV2.GroupLabel>{server!.name}</MenuV2.GroupLabel>
                    <MenuV2.RadioGroup value={selectedValue()} class="flex flex-col gap-0.5">
                      <For each={props.controller.projects().filter((project) => project.server?.key === server!.key)}>
                        {(project) => (
                          <ProjectItem project={project} controller={props.controller} onSelect={selectProject} />
                        )}
                      </For>
                    </MenuV2.RadioGroup>
                  </MenuV2.Group>
                )}
              </For>
            </Show>
          </div>
          <MenuV2.Separator />
          <Show
            when={props.controller.servers().length > 1}
            fallback={
              <ProjectAction
                server={props.controller.servers()[0]?.key}
                controller={props.controller}
                onSelect={selectAction}
              />
            }
          >
            <MenuV2.Sub>
              <MenuV2.SubTrigger
                id={props.controller.actionKey()}
                data-option-key={props.controller.actionKey()}
                classList={{ [activeOverlayClass]: props.controller.active() === props.controller.actionKey() }}
                onMouseEnter={() => props.controller.setActive(props.controller.actionKey())}
              >
                <Icon name="plus" size="small" class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">{props.controller.labels.add()}</span>
              </MenuV2.SubTrigger>
              <MenuV2.Portal>
                <MenuV2.SubContent class={`min-w-[180px] ${menuSurfaceClass}`}>
                  <For each={props.controller.servers()}>
                    {(server) => (
                      <MenuV2.Item onSelect={() => selectAction(server!.key)}>
                        <span class="min-w-0 flex-1 truncate">{server!.name}</span>
                      </MenuV2.Item>
                    )}
                  </For>
                </MenuV2.SubContent>
              </MenuV2.Portal>
            </MenuV2.Sub>
          </Show>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

export function PromptProjectAddButton(props: { controller: PromptProjectController }) {
  return (
    <button
      data-action="prompt-project"
      type="button"
      class={`${chipClass} max-w-[160px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover`}
      onClick={() => props.controller.add()}
    >
      <Icon name="folder-add-left" size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 truncate leading-5">{props.controller.labels.new()}</span>
      <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
    </button>
  )
}

/** Composer chip: a pill that tightens its corners while pressed. */
const chipClass =
  "flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-[440] leading-5 tracking-[-0.04px] transition-[background-color,border-radius] duration-200 ease-standard active:rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"

function ProjectTrigger(props: ComponentProps<"button"> & { controller: PromptProjectController }) {
  const [local, rest] = splitProps(props, ["controller", "class", "classList", "onClick", "onKeyDown"])
  const project = () => local.controller.selected()
  return (
    <button
      {...rest}
      data-action="prompt-project"
      type="button"
      class={`${chipClass} max-w-[220px] pl-1.5`}
      classList={{
        ...local.classList,
        "hover:bg-v2-overlay-simple-overlay-hover": !local.controller.open(),
        "bg-v2-overlay-simple-overlay-pressed": local.controller.open(),
        "text-v2-text-text-muted": local.controller.open(),
      }}
      onClick={local.onClick ?? (() => local.controller.setOpen(true))}
      onKeyDown={(event) => {
        if (!local.controller.open() && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (typeof local.onKeyDown === "function") local.onKeyDown(event)
      }}
    >
      <Show
        when={project()}
        fallback={<Icon name="folder-add-left" size="small" class="shrink-0 text-v2-icon-icon-muted" />}
      >
        {(item) => (
          <ProjectAvatar
            fallback={displayName(item())}
            src={getProjectAvatarSource(item().id, item().icon)}
            variant={getProjectAvatarVariant(item().icon?.color)}
          />
        )}
      </Show>
      <span class="min-w-0 truncate leading-5">
        {project() ? displayName(project()!) : local.controller.labels.new()}
      </span>
      <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
    </button>
  )
}

function ProjectItem(props: {
  project: PromptProject
  controller: PromptProjectController
  onSelect: (project: PromptProject) => void
}) {
  const key = () => props.controller.projectKey(props.project)
  return (
    <MenuV2.RadioItem
      id={key()}
      value={key()}
      data-option-key={key()}
      classList={{ [activeOverlayClass]: props.controller.active() === key() }}
      closeOnSelect
      onMouseEnter={() => {
        props.controller.setActive(key())
        props.controller.focusSearch()
      }}
      onSelect={() => props.onSelect(props.project)}
    >
      <ProjectAvatar
        fallback={displayName(props.project)}
        src={getProjectAvatarSource(props.project.id, props.project.icon)}
        variant={getProjectAvatarVariant(props.project.icon?.color)}
      />
      <span class="min-w-0 truncate">{displayName(props.project)}</span>
    </MenuV2.RadioItem>
  )
}

function ProjectAction(props: {
  server?: string
  controller: PromptProjectController
  onSelect: (server?: string) => void
}) {
  const key = () => props.controller.actionKey(props.server)
  return (
    <MenuV2.Item
      id={key()}
      data-option-key={key()}
      classList={{ [activeOverlayClass]: props.controller.active() === key() }}
      onMouseEnter={() => {
        props.controller.setActive(key())
        props.controller.focusSearch()
      }}
      onSelect={() => props.onSelect(props.server)}
    >
      <Icon name="plus" size="small" class="shrink-0" />
      <span class="min-w-0 truncate">{props.controller.labels.add()}</span>
    </MenuV2.Item>
  )
}
