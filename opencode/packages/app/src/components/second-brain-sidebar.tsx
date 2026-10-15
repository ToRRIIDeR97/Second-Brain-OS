import type { Session } from "@opencode-ai/sdk/v2/client"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, type JSX, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
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
import { DialogArchivedThreads } from "@/components/sidebar/dialog-archived-threads"
import type { ThreadNode } from "@/features/second-brain/sidebar-threads"
import { sessionPinnedAt } from "@/utils/session"
import { sessionTitle } from "@/utils/session-title"

const rowClass =
  "group/row relative grid h-9 w-full min-w-0 shrink-0 cursor-default items-center overflow-hidden rounded-full bg-transparent text-left text-[13px] text-v2-text-text-muted [font-weight:440] transition-[background-color,color,border-radius] duration-200 ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base active:rounded-[12px] data-[selected]:bg-v2-background-bg-accent-container data-[selected]:text-v2-text-text-on-accent-container data-[selected]:[font-weight:530] focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"

export function SecondBrainSidebar() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const openSettings = useSettingsDialog()
  const ctrl = createSidebarController()
  const path = () => ctrl.location.pathname
  const items = () => [
    { id: "overview", icon: "home" as const, label: language.t("secondBrain.sidebar.overview"), href: "/" },
    { id: "notes", icon: "book" as const, label: language.t("secondBrain.sidebar.notes"), href: "/notes" },
    { id: "calendar", icon: "calendar" as const, label: language.t("secondBrain.sidebar.calendar"), href: "/calendar" },
    { id: "activity", icon: "activity" as const, label: language.t("secondBrain.sidebar.activity"), href: "/activity" },
  ]

  return (
    <div
      data-component="second-brain-sidebar"
      data-expanded={layout.sidebar.opened() ? "" : undefined}
      class="hidden min-h-0 shrink-0 md:flex"
    >
      <nav
        class="flex w-20 shrink-0 flex-col items-center gap-3 pb-4 pt-2"
        aria-label={language.t("secondBrain.sidebar.title")}
      >
        <TooltipV2 placement="right" value={language.t("secondBrain.sidebar.newThread")}>
          <button
            type="button"
            data-sidebar-item="new-thread"
            class="mb-3 flex size-14 items-center justify-center rounded-[16px] bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container transition-[border-radius,background-color,transform] duration-300 ease-spring hover:rounded-[20px] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
            aria-label={language.t("secondBrain.sidebar.newThread")}
            onClick={() => ctrl.newThread()}
          >
            <Icon name="plus" size="large" />
          </button>
        </TooltipV2>
        <For each={items()}>
          {(item) => (
            <RailItem
              id={item.id}
              icon={item.icon}
              label={item.label}
              active={path() === item.href}
              onClick={() => navigate(item.href)}
            />
          )}
        </For>
        <div class="flex-1" />
        <TooltipV2 placement="right" value={language.t("sidebar.settings")}>
          <IconButtonV2
            type="button"
            data-sidebar-item="settings"
            variant="ghost-muted"
            class="!size-11"
            icon={<Icon name="settings-gear" size="large" />}
            aria-label={language.t("sidebar.settings")}
            onClick={() => openSettings()}
          />
        </TooltipV2>
      </nav>

      <aside
        aria-label={language.t("secondBrain.sidebar.projectsSection")}
        classList={{
          "flex min-h-0 flex-col overflow-hidden transition-[width,opacity] duration-300 ease-emphasized will-change-[width] motion-reduce:transition-none": true,
          "w-[248px] opacity-100": layout.sidebar.opened(),
          "w-0 opacity-0": !layout.sidebar.opened(),
        }}
      >
        <Show when={layout.sidebar.opened()}>
          <div
            data-sidebar-section="projects"
            class="flex min-h-0 w-[248px] flex-1 flex-col overflow-y-auto pb-3 pr-2 pt-1"
          >
            <SectionHeader
              id="projects"
              label={language.t("secondBrain.sidebar.projectsSection")}
              active={path() === "/projects"}
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
              <p class="px-3 py-1 text-[12px] text-v2-text-text-faint">
                {language.t("secondBrain.sidebar.noProjects")}
              </p>
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
      </aside>
    </div>
  )
}

/** Material 3 navigation rail destination: icon in a pill indicator that grows in when selected, label below. */
function RailItem(props: { id: string; icon: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-sidebar-item={props.id}
      data-selected={props.active ? "" : undefined}
      class="group/rail flex w-full flex-col items-center gap-1 text-[12px] text-v2-text-text-muted [font-weight:500] focus-visible:outline-none data-[selected]:text-v2-text-text-base data-[selected]:[font-weight:600]"
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
    >
      <span class="relative flex h-8 w-14 items-center justify-center">
        <span
          classList={{
            "absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full transition-[width,background-color] duration-[450ms] ease-standard motion-reduce:transition-none": true,
            "w-14 bg-v2-background-bg-accent-container": !!props.active,
            "w-0 group-hover/rail:w-14 group-hover/rail:bg-v2-overlay-simple-overlay-hover": !props.active,
          }}
        />
        <span class="relative flex text-v2-icon-icon-muted group-data-[selected]/rail:text-v2-text-text-on-accent-container group-focus-visible/rail:rounded-full group-focus-visible/rail:ring-2 group-focus-visible/rail:ring-v2-border-border-focus">
          <Icon name={props.icon} size="large" />
        </span>
      </span>
      <span class="max-w-full truncate px-1">{props.label}</span>
    </button>
  )
}

function SectionHeader(props: {
  id?: string
  label: string
  labelTitle?: string
  active?: boolean
  onLabel?: () => void
  action?: { label: string; icon: JSX.Element; run: () => void }
}) {
  return (
    <div class="flex h-10 shrink-0 items-center gap-1 pl-1 pr-0.5">
      <button
        type="button"
        data-sidebar-item={props.id}
        data-selected={props.active ? "" : undefined}
        aria-current={props.active ? "page" : undefined}
        class="min-w-0 truncate rounded-full px-3 py-1 text-left text-[13px] text-v2-text-text-base [font-weight:600] transition-colors duration-200 ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus data-[selected]:bg-v2-background-bg-accent-container data-[selected]:text-v2-text-text-on-accent-container"
        title={props.labelTitle}
        onClick={() => props.onLabel?.()}
      >
        {props.label}
      </button>
      <div class="flex-1" />
      <Show when={props.action}>
        {(action) => (
          <TooltipV2 placement="right" value={action().label}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="large"
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
      class="flex size-4 items-center justify-center text-v2-icon-icon-muted transition-transform duration-150 ease-standard motion-reduce:transition-none"
      classList={{ "-rotate-90": !props.open }}
    >
      <Icon name="chevron-down" size="small" />
    </span>
  )
}

function ProjectGroup(props: { ctrl: SidebarController; project: SidebarProjectItem; threads: ThreadNode<Session>[] }) {
  const language = useLanguage()
  const dialog = useDialog()
  const open = () => props.ctrl.expanded(props.project.id)
  return (
    <div data-sidebar-project={props.project.id} class="flex flex-col">
      <div
        class={`${rowClass} grid-cols-[1fr_auto]`}
        data-selected={props.ctrl.activeProjectID() === props.project.id && !open() ? "" : undefined}
      >
        <button
          type="button"
          class="flex h-9 min-w-0 items-center gap-1.5 pl-3 text-left focus-visible:outline-none"
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
                <MenuV2.Item
                  onSelect={() =>
                    dialog.show(() => <DialogArchivedThreads ctrl={props.ctrl} project={props.project} />)
                  }
                >
                  {language.t("secondBrain.sidebar.archivedThreads")}
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
          class="flex h-9 min-w-0 items-center gap-1.5 pl-3 text-left focus-visible:outline-none"
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
            class={`${rowClass} grid-cols-[1fr] pl-8 text-v2-text-text-faint`}
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
        <p class="py-1 pl-8 text-[12px] text-v2-text-text-faint">{language.t("secondBrain.sidebar.noThreads")}</p>
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
  const pinned = () => sessionPinnedAt(session()) !== undefined
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
        style={{ "padding-left": `${24 + props.depth * 12}px` }}
      >
        <Show
          when={editing()}
          fallback={
            <button
              type="button"
              class="flex h-9 min-w-0 items-center gap-1.5 pl-2 pr-1 text-left focus-visible:outline-none"
              data-sidebar-thread-open
              aria-current={active() ? "page" : undefined}
              onClick={() => props.ctrl.openThread(session())}
              onDblClick={() => {
                saved = false
                setEditing(true)
              }}
            >
              <span class="min-w-0 flex-1 truncate">{title()}</span>
              <Show when={pinned()}>
                <span
                  data-sidebar-pinned
                  class="flex shrink-0 items-center text-v2-icon-icon-muted"
                  role="img"
                  aria-label={language.t("secondBrain.sidebar.pinned")}
                >
                  <Icon name="pin" size="small" />
                </span>
              </Show>
              <Show when={props.ctrl.working(session().id)}>
                <span
                  data-sidebar-running
                  class="size-2 shrink-0 animate-[running-pulse_1.6s_var(--v2-ease-standard)_infinite] rounded-full bg-v2-icon-icon-accent motion-reduce:animate-none"
                  role="status"
                  aria-label={language.t("secondBrain.sidebar.running")}
                />
              </Show>
            </button>
          }
        >
          <input
            ref={(el) => queueMicrotask(() => el.select())}
            class="mx-1 h-7 min-w-0 rounded-full bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-base outline-none [box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] focus:[box-shadow:inset_0_0_0_2px_var(--v2-border-border-focus)]"
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
                <MenuV2.Item onSelect={() => void props.ctrl.setThreadPinned(session(), !pinned())}>
                  {language.t(pinned() ? "secondBrain.sidebar.unpin" : "secondBrain.sidebar.pin")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={() => void props.ctrl.forkThread(session())}>
                  {language.t("secondBrain.sidebar.fork")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={() => void props.ctrl.archiveThread(session())}>
                  {language.t("common.archive")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={() => props.ctrl.deleteThread(session())}>
                  {language.t("common.delete")}
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
