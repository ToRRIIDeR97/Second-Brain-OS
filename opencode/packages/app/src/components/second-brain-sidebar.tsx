import type { Session } from "@opencode-ai/sdk/v2/client"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, type JSX, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettingsDialog } from "@/components/settings-dialog"
import {
  BRAIN_GROUP,
  createSidebarController,
  OTHER_GROUP,
  type SidebarController,
  type SidebarProjectItem,
} from "@/components/sidebar/sidebar-controller"
import type { ThreadNode } from "@/features/second-brain/sidebar-threads"
import { sessionTitle } from "@/utils/session-title"

const rowClass =
  "group/row relative grid h-8 w-full min-w-0 shrink-0 cursor-default items-center overflow-hidden rounded-[6px] bg-transparent text-left text-[13px] text-v2-text-text-muted [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base data-[selected]:hover:bg-v2-background-bg-layer-03 focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"

export function SecondBrainSidebar() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const openSettings = useSettingsDialog()
  const ctrl = createSidebarController()
  const path = () => ctrl.location.pathname
  const items = () => [
    { id: "overview", icon: "home" as const, label: language.t("secondBrain.sidebar.overview"), href: "/" },
    { id: "notes", icon: "edit" as const, label: language.t("secondBrain.sidebar.notes"), href: "/notes" },
    { id: "calendar", icon: "status" as const, label: language.t("secondBrain.sidebar.calendar"), href: "/calendar" },
    { id: "activity", icon: "status" as const, label: language.t("secondBrain.sidebar.activity"), href: "/activity" },
  ]

  return (
    <aside
      data-component="second-brain-sidebar"
      data-expanded={layout.sidebar.opened() ? "" : undefined}
      classList={{
        "hidden md:flex shrink-0 min-h-0 flex-col overflow-hidden bg-v2-background-bg-deep transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none": true,
        "w-[260px]": layout.sidebar.opened(),
        "w-12": !layout.sidebar.opened(),
      }}
      aria-label={language.t("secondBrain.sidebar.title")}
    >
      <nav class="flex shrink-0 flex-col gap-1 px-2 py-1">
        <For each={items()}>
          {(item) => (
            <NavRow
              id={item.id}
              icon={<Icon name={item.icon} size="small" />}
              label={item.label}
              active={path() === item.href}
              opened={layout.sidebar.opened()}
              onClick={() => navigate(item.href)}
            />
          )}
        </For>
      </nav>

      <Show when={layout.sidebar.opened()}>
        <div data-sidebar-section="projects" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 pt-3">
          <SectionHeader
            label={language.t("secondBrain.sidebar.projectsSection")}
            onLabel={() => navigate("/projects")}
            labelTitle={language.t("secondBrain.sidebar.manageProjects")}
            action={{
              label: language.t("secondBrain.command.openFolder"),
              icon: <Icon name="folder-add-left" size="small" />,
              run: ctrl.chooseFolder,
            }}
          />
          <For each={ctrl.groups().projects}>
            {(group) => <ProjectGroup ctrl={ctrl} project={group.project} threads={group.threads} />}
          </For>
          <Show when={!ctrl.loading() && ctrl.projects().length === 0}>
            <p class="px-2 py-1 text-[12px] text-v2-text-text-faint">{language.t("secondBrain.sidebar.noProjects")}</p>
          </Show>
          <Show when={ctrl.brainDirectory()}>
            <ThreadGroup
              ctrl={ctrl}
              id={BRAIN_GROUP}
              label={language.t("secondBrain.sidebar.brain")}
              threads={ctrl.groups().brain}
              onNewThread={ctrl.newBrainThread}
            />
          </Show>
          <Show when={ctrl.groups().other.length > 0}>
            <ThreadGroup
              ctrl={ctrl}
              id={OTHER_GROUP}
              label={language.t("secondBrain.sidebar.otherThreads")}
              threads={ctrl.groups().other}
            />
          </Show>
        </div>
      </Show>
      <Show when={!layout.sidebar.opened()}>
        <div class="flex-1" />
      </Show>

      <div class="shrink-0 px-2 pb-5 pt-2">
        <NavRow
          id="settings"
          icon={<Icon name="settings-gear" size="small" />}
          label={language.t("sidebar.settings")}
          opened={layout.sidebar.opened()}
          onClick={openSettings}
        />
      </div>
    </aside>
  )
}

function NavRow(props: {
  id: string
  icon: JSX.Element
  label: string
  active?: boolean
  opened: boolean
  onClick: () => void
}) {
  return (
    <TooltipV2 placement="right" value={props.label} inactive={props.opened}>
      <button
        type="button"
        data-sidebar-item={props.id}
        data-selected={props.active ? "" : undefined}
        class={`${rowClass} grid-cols-[32px_1fr]`}
        onClick={props.onClick}
        aria-current={props.active ? "page" : undefined}
        aria-label={props.label}
      >
        <span class="flex size-8 items-center justify-center text-v2-icon-icon-muted">{props.icon}</span>
        <span
          classList={{
            "min-w-0 truncate pl-1 transition-[opacity,transform] motion-reduce:transition-none": true,
            "translate-x-0 opacity-100 duration-180 ease-out": props.opened,
            "pointer-events-none -translate-x-1 opacity-0 duration-120 ease-in": !props.opened,
          }}
        >
          {props.label}
        </span>
      </button>
    </TooltipV2>
  )
}

function SectionHeader(props: {
  label: string
  labelTitle?: string
  onLabel?: () => void
  action?: { label: string; icon: JSX.Element; run: () => void }
}) {
  return (
    <div class="flex h-7 shrink-0 items-center gap-1 pl-2 pr-0.5">
      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left text-[11px] uppercase tracking-[0.04em] text-v2-text-text-faint [font-weight:530] hover:text-v2-text-text-muted focus-visible:outline-none"
        title={props.labelTitle}
        onClick={() => props.onLabel?.()}
      >
        {props.label}
      </button>
      <Show when={props.action}>
        {(action) => (
          <TooltipV2 placement="right" value={action().label}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              icon={action().icon}
              aria-label={action().label}
              onClick={action().run}
            />
          </TooltipV2>
        )}
      </Show>
    </div>
  )
}

function Chevron(props: { open: boolean }) {
  return (
    <span
      class="flex size-4 items-center justify-center text-v2-icon-icon-muted transition-transform duration-[120ms]"
      classList={{ "-rotate-90": !props.open }}
    >
      <Icon name="chevron-down" size="small" />
    </span>
  )
}

function ProjectGroup(props: { ctrl: SidebarController; project: SidebarProjectItem; threads: ThreadNode<Session>[] }) {
  const language = useLanguage()
  const open = () => props.ctrl.expanded(props.project.id)
  return (
    <div data-sidebar-project={props.project.id} class="flex flex-col">
      <div
        class={`${rowClass} grid-cols-[1fr_auto]`}
        data-selected={props.ctrl.activeProjectID() === props.project.id && !open() ? "" : undefined}
      >
        <button
          type="button"
          class="flex h-8 min-w-0 items-center gap-1.5 pl-1.5 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.project.id)}
        >
          <Chevron open={open()} />
          <span
            class="min-w-0 truncate"
            classList={{ "text-v2-text-text-base": props.ctrl.activeProjectID() === props.project.id }}
          >
            {props.project.name}
          </span>
        </button>
        <div class="flex items-center gap-0.5 pr-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
          <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.newThread")}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="plus" size="small" />}
              aria-label={language.t("secondBrain.sidebar.newThread")}
              onClick={() => props.ctrl.newThread(props.project)}
            />
          </TooltipV2>
          <MenuV2 gutter={4} modal={false} placement="bottom-start">
            <MenuV2.Trigger
              as={IconButtonV2}
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" size="small" />}
              aria-label={language.t("secondBrain.sidebar.projectActions")}
            />
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item onSelect={() => props.ctrl.newThread(props.project)}>
                  {language.t("secondBrain.sidebar.newThread")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={() => props.ctrl.openProjectCard(props.project)}>
                  {language.t("secondBrain.sidebar.openProjectCard")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={() => void props.ctrl.archiveProject(props.project)}>
                  {language.t("secondBrain.sidebar.archiveProject")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>
      <Show when={open()}>
        <ThreadList ctrl={props.ctrl} threads={props.threads} onNewThread={() => props.ctrl.newThread(props.project)} />
      </Show>
    </div>
  )
}

function ThreadGroup(props: {
  ctrl: SidebarController
  id: string
  label: string
  threads: ThreadNode<Session>[]
  onNewThread?: () => void
}) {
  const language = useLanguage()
  const open = () => props.ctrl.expanded(props.id)
  return (
    <div data-sidebar-group={props.id} class="mt-2 flex flex-col">
      <div class={`${rowClass} grid-cols-[1fr_auto]`}>
        <button
          type="button"
          class="flex h-8 min-w-0 items-center gap-1.5 pl-1.5 text-left focus-visible:outline-none"
          aria-expanded={open()}
          onClick={() => props.ctrl.toggleExpanded(props.id)}
        >
          <Chevron open={open()} />
          <span class="min-w-0 truncate">{props.label}</span>
        </button>
        <Show when={props.onNewThread}>
          {(run) => (
            <div class="flex items-center pr-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
              <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.newThread")}>
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="plus" size="small" />}
                  aria-label={language.t("secondBrain.sidebar.newThread")}
                  onClick={run()}
                />
              </TooltipV2>
            </div>
          )}
        </Show>
      </div>
      <Show when={open()}>
        <ThreadList ctrl={props.ctrl} threads={props.threads} onNewThread={props.onNewThread} />
      </Show>
    </div>
  )
}

function ThreadList(props: { ctrl: SidebarController; threads: ThreadNode<Session>[]; onNewThread?: () => void }) {
  const language = useLanguage()
  return (
    <div class="flex flex-col">
      <Show when={props.onNewThread}>
        {(run) => (
          <button
            type="button"
            data-sidebar-new-thread
            class={`${rowClass} grid-cols-[1fr] pl-7 text-v2-text-text-faint`}
            onClick={run()}
          >
            <span class="flex min-w-0 items-center gap-1.5">
              <Icon name="plus" size="small" />
              <span class="truncate">{language.t("secondBrain.sidebar.newThread")}</span>
            </span>
          </button>
        )}
      </Show>
      <For each={props.threads}>{(node) => <ThreadRow ctrl={props.ctrl} node={node} depth={0} />}</For>
      <Show when={!props.onNewThread && props.threads.length === 0}>
        <p class="py-1 pl-7 text-[12px] text-v2-text-text-faint">{language.t("secondBrain.sidebar.noThreads")}</p>
      </Show>
    </div>
  )
}

const containsSession = (node: ThreadNode<Session>, sessionID: string | undefined): boolean =>
  !!sessionID && (node.session.id === sessionID || node.children.some((child) => containsSession(child, sessionID)))

function ThreadRow(props: { ctrl: SidebarController; node: ThreadNode<Session>; depth: number }) {
  const language = useLanguage()
  const [editing, setEditing] = createSignal(false)
  const session = () => props.node.session
  const active = () => props.ctrl.activeSessionID() === session().id
  const title = () => sessionTitle(session().title) || session().id
  // Child threads show while their parent's lineage is on screen.
  const showChildren = () => props.node.children.length > 0 && containsSession(props.node, props.ctrl.activeSessionID())
  let saved = false
  const finish = (value: string | undefined) => {
    if (saved) return
    saved = true
    setEditing(false)
    if (value !== undefined) void props.ctrl.renameThread(session(), value)
  }

  return (
    <>
      <div
        data-sidebar-thread={session().id}
        data-selected={active() ? "" : undefined}
        class={`${rowClass} grid-cols-[1fr_auto]`}
        style={{ "padding-left": `${20 + props.depth * 12}px` }}
      >
        <Show
          when={editing()}
          fallback={
            <button
              type="button"
              class="flex h-8 min-w-0 items-center gap-1.5 pl-2 text-left focus-visible:outline-none"
              aria-current={active() ? "page" : undefined}
              onClick={() => props.ctrl.openThread(session())}
              onDblClick={() => {
                saved = false
                setEditing(true)
              }}
            >
              <span class="min-w-0 flex-1 truncate">{title()}</span>
              <Show when={props.ctrl.working(session().id)}>
                <span
                  data-sidebar-running
                  class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-accent"
                  role="status"
                  aria-label={language.t("secondBrain.sidebar.running")}
                />
              </Show>
            </button>
          }
        >
          <input
            ref={(el) => queueMicrotask(() => el.select())}
            class="mx-1 h-6 min-w-0 rounded-[4px] bg-v2-background-bg-base px-1.5 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"
            value={session().title ?? ""}
            aria-label={language.t("secondBrain.sidebar.renameThread")}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") finish(event.currentTarget.value)
              if (event.key === "Escape") finish(undefined)
            }}
            onBlur={(event) => finish(event.currentTarget.value)}
          />
        </Show>
        <div class="flex items-center pr-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
          <MenuV2 gutter={4} modal={false} placement="bottom-start">
            <MenuV2.Trigger
              as={IconButtonV2}
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" size="small" />}
              aria-label={language.t("secondBrain.sidebar.threadActions")}
            />
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item
                  onSelect={() => {
                    saved = false
                    setEditing(true)
                  }}
                >
                  {language.t("common.rename")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={() => void props.ctrl.forkThread(session())}>
                  {language.t("secondBrain.sidebar.fork")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={() => void props.ctrl.archiveThread(session())}>
                  {language.t("common.archive")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>
      <Show when={showChildren()}>
        <For each={props.node.children}>
          {(child) => <ThreadRow ctrl={props.ctrl} node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </>
  )
}
