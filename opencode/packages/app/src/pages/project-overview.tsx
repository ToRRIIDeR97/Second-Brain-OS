import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageFrame, PageHeader, pageRowClass } from "@/components/page"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { localDateKey } from "@/features/second-brain/calendar-domain"
import { listNotes, listProjects, readCalendar } from "@/features/second-brain/client"
import {
  filterProjectOverview,
  groupProjectOverview,
  type OverviewGroup,
} from "@/features/second-brain/project-overview"

const preview = 5
const statusKey = {
  active: "secondBrain.projects.filter.active",
  paused: "secondBrain.projects.filter.paused",
  archived: "secondBrain.projects.filter.archived",
} as const

/** Every Project's upcoming work and recent notes on one page, for the workspace the sidebar has selected. */
export default function ProjectOverviewPage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const navigate = useNavigate()
  const command = useCommand()
  const serverSDK = useServerSDK()
  const [state, setState] = createStore({ filter: "" })
  const client = (directory: string) => ({ server: serverSDK().server, fetch: platform.fetch, target: { directory } })

  // The sidebar workspace switcher owns this choice; each resource reloads when it changes.
  const brainDirectory = () => layout.home.workspace() ?? ""
  const source = () => brainDirectory() || undefined
  const [projects, projectActions] = createResource(source, (directory) => listProjects(client(directory)))
  const [notes, noteActions] = createResource(source, (directory) => listNotes(client(directory)))
  const [calendar, calendarActions] = createResource(source, (directory) => readCalendar(client(directory)))

  const loading = () => projects.loading || notes.loading || calendar.loading
  const failed = () => !!projects.error || !!notes.error || !!calendar.error
  const retry = () => {
    if (projects.error) void projectActions.refetch()
    if (notes.error) void noteActions.refetch()
    if (calendar.error) void calendarActions.refetch()
  }
  // Reading a failed resource throws, so every read waits until none has failed.
  const groups = createMemo(() =>
    loading() || failed()
      ? []
      : groupProjectOverview({
          projects: projects.latest ?? [],
          notes: notes.latest ?? [],
          calendar: calendar.latest,
          today: localDateKey(new Date()),
        }),
  )
  const progress = createMemo(
    () => new Map((failed() ? [] : (projects.latest ?? [])).map((project) => [project.id, project.progressPercent])),
  )
  const visible = createMemo(() => filterProjectOverview(groups(), state.filter))

  const dateFormat = createMemo(() => new Intl.DateTimeFormat(language.locale(), { month: "short", day: "numeric" }))
  // Calendar dates are local `YYYY-MM-DD` keys; noon keeps them on the same day in every time zone.
  const formatDate = (date: string) => {
    const [year, month, day] = date.split("-").map(Number)
    if (!year || !month || !day) return date
    return dateFormat().format(new Date(year, month - 1, day, 12))
  }
  const projectQuery = (group: OverviewGroup) =>
    group.projectId ? `project=${encodeURIComponent(group.projectId)}` : ""
  const openNote = (group: OverviewGroup, path: string) =>
    navigate(`/notes?${[projectQuery(group), `note=${encodeURIComponent(path)}`].filter(Boolean).join("&")}`)
  const openAll = (page: "notes" | "calendar", group: OverviewGroup) =>
    navigate(group.projectId ? `/${page}?${projectQuery(group)}` : `/${page}`)

  return (
    <PageFrame labelledBy="project-overview-title">
      <Show
        when={brainDirectory()}
        fallback={
          <>
            <PageHeader id="project-overview-title" title={language.t("secondBrain.projects.overview.title")} />
            <PageEmpty
              action={
                <ButtonV2 variant="contrast" onClick={() => command.trigger("project.open")}>
                  {language.t("secondBrain.home.openWorkspace")}
                </ButtonV2>
              }
            >
              {language.t("secondBrain.empty.workspace")}
            </PageEmpty>
          </>
        }
      >
        <header class="flex min-h-14 shrink-0 flex-wrap items-center gap-2 pl-3 pr-6 pt-3">
          <TooltipV2 value={language.t("secondBrain.projects.back")}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              class="!size-8"
              aria-label={language.t("secondBrain.projects.back")}
              icon={
                <span class="flex rotate-90">
                  <Icon name="chevron-down" size="small" />
                </span>
              }
              onClick={() => navigate("/projects")}
            />
          </TooltipV2>
          <h1
            id="project-overview-title"
            class="min-w-0 flex-1 truncate text-[17px] text-v2-text-text-base [font-weight:560]"
          >
            {language.t("secondBrain.projects.overview.title")}
          </h1>
        </header>
        <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pb-10 pt-2">
          <label class="relative block">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" />
            </span>
            <input
              class="h-9 w-full rounded-full bg-v2-background-bg-layer-01 pl-9 pr-3 text-[13px] text-v2-text-text-base outline-none transition-[background-color,box-shadow] duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
              aria-label={language.t("secondBrain.projects.overview.filter")}
              placeholder={language.t("secondBrain.projects.overview.filter")}
              value={state.filter}
              onInput={(event) => setState("filter", event.currentTarget.value)}
            />
          </label>
          <Show
            when={!loading()}
            fallback={<p class="px-3 py-2 text-[13px] text-v2-text-text-faint">{language.t("common.loading")}</p>}
          >
            <Show
              when={!failed()}
              fallback={
                <PageEmpty
                  action={
                    <ButtonV2 variant="outline" onClick={retry}>
                      {language.t("secondBrain.error.retry")}
                    </ButtonV2>
                  }
                >
                  {language.t("secondBrain.error.request")}
                </PageEmpty>
              }
            >
              <Show
                when={visible().length > 0}
                fallback={
                  <PageEmpty>
                    {language.t(
                      groups().length > 0
                        ? "secondBrain.projects.overview.noMatches"
                        : "secondBrain.projects.overview.empty",
                    )}
                  </PageEmpty>
                }
              >
                <For each={visible()}>
                  {(group, index) => {
                    const heading = () => `project-overview-group-${index()}`
                    return (
                      <section class="flex flex-col gap-3" aria-labelledby={heading()}>
                        <div class="flex min-w-0 items-baseline gap-2 px-3">
                          <h2
                            id={heading()}
                            class="min-w-0 flex-1 truncate text-[15px] text-v2-text-text-base [font-weight:560]"
                          >
                            {group.name || language.t("secondBrain.projects.overview.workspace")}
                          </h2>
                          <Show when={group.status}>
                            {(status) => (
                              <span class="shrink-0 text-[12px] text-v2-text-text-faint">
                                {language.t(statusKey[status()])}
                              </span>
                            )}
                          </Show>
                          <Show when={group.projectId}>
                            {(id) => (
                              <span class="w-10 shrink-0 text-right text-[12px] tabular-nums text-v2-text-text-muted">
                                {progress().get(id()) ?? 0}%
                              </span>
                            )}
                          </Show>
                        </div>
                        <Show when={group.nextMilestone}>
                          {(milestone) => (
                            <div class="px-3">
                              <p class="text-[12px] text-v2-text-text-muted">
                                {language.t("secondBrain.projects.nextMilestone")}
                              </p>
                              <p class="mt-1 text-[13px] leading-5 text-v2-text-text-base">{milestone()}</p>
                            </div>
                          )}
                        </Show>
                        <Show when={group.items.length === 0 && group.notes.length === 0}>
                          <p class="px-3 text-[13px] text-v2-text-text-faint">
                            {language.t("secondBrain.projects.overview.nothing")}
                          </p>
                        </Show>
                        <Show when={group.items.length > 0}>
                          <div class="flex flex-col gap-1">
                            <div class="flex h-8 items-center gap-1 pl-3">
                              <h3 class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted [font-weight:530]">
                                {language.t("secondBrain.projects.overview.upcoming")}
                              </h3>
                              <Show when={group.items.length > preview}>
                                <ButtonV2 variant="ghost" size="small" onClick={() => openAll("calendar", group)}>
                                  {language.t("secondBrain.projects.overview.showAll")}
                                </ButtonV2>
                              </Show>
                            </div>
                            <ul class="flex flex-col gap-0.5">
                              <For each={group.items.slice(0, preview)}>
                                {(item) => (
                                  <li class="grid min-h-10 grid-cols-[100px_minmax(0,1fr)] items-center gap-3 rounded-[16px] px-3">
                                    <span class="text-[11px] tabular-nums text-v2-text-text-faint">
                                      {item.date ? formatDate(item.date) : language.t("secondBrain.tasks.unscheduled")}
                                    </span>
                                    <span class="truncate text-[13px] text-v2-text-text-base">{item.title}</span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                        <Show when={group.notes.length > 0}>
                          <div class="flex flex-col gap-1">
                            <div class="flex h-8 items-center gap-1 pl-3">
                              <h3 class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted [font-weight:530]">
                                {language.t("secondBrain.projects.overview.notes")}
                              </h3>
                              <Show when={group.notes.length > preview}>
                                <ButtonV2 variant="ghost" size="small" onClick={() => openAll("notes", group)}>
                                  {language.t("secondBrain.projects.overview.showAll")}
                                </ButtonV2>
                              </Show>
                            </div>
                            <ul class="flex flex-col gap-0.5">
                              <For each={group.notes.slice(0, preview)}>
                                {(note) => (
                                  <li>
                                    <button
                                      type="button"
                                      class={pageRowClass}
                                      onClick={() => openNote(group, note.path)}
                                    >
                                      <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">
                                        {note.title}
                                      </span>
                                    </button>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                      </section>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </PageFrame>
  )
}
