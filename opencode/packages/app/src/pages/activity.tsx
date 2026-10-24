import { useNavigate } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { PageEmpty, PageFrame, PageHeader, pageRowClass } from "@/components/page"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeScrollController } from "@/pages/home/home-scroll-controller"
import { createHomeSessionSearchController } from "@/pages/home/home-session-search-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { HomeSessions } from "@/pages/home/home-sessions"
import { getRelativeTime } from "@/utils/time"
import { agentRuns, agentRunStatus } from "./activity-runs"

export default function ActivityPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const platform = usePlatform()
  const home = createHomeController()
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  const [view, setView] = createSignal<ActivityView>("attention")
  const [google] = createResource(
    () => platform.googleCalendar,
    (planner) => planner.status(),
  )
  // Reading a failed resource throws; a Google status failure just hides its rows.
  const googleStatus = () => (google.error ? undefined : google())
  // Threads that wait on the user: a permission request or a question. Plain running threads are in Agent runs.
  const attention = createMemo(() => {
    const data = home.server.focusedSync().session.data
    return sessions.data
      .records()
      .filter(
        (record) =>
          (data.permission[record.session.id]?.length ?? 0) > 0 || (data.question[record.session.id]?.length ?? 0) > 0,
      )
  })
  const changes = createMemo(() => sessions.data.records().filter((record) => (record.session.summary?.files ?? 0) > 0))
  const runs = createMemo(() => {
    const data = home.server.focusedSync().session.data
    return agentRuns(sessions.data.records(), (record) =>
      agentRunStatus(data.session_status[record.session.id], data.permission[record.session.id]?.length ?? 0),
    )
  })

  return (
    <PageFrame labelledBy="activity-title" class="flex flex-col">
      <PageHeader id="activity-title" title={language.t("secondBrain.activity.title")} />
      <div class="shrink-0 px-6 pb-2 pt-1">
        <SegmentedControlV2
          aria-label={language.t("secondBrain.activity.views")}
          class="!w-fit"
          value={view()}
          onChange={(value) => value && setView(value as ActivityView)}
        >
          <For each={activityViews}>
            {(item) => (
              <SegmentedControlItemV2 value={item} class="whitespace-nowrap">
                {language.t(`secondBrain.activity.view.${item}`)}
              </SegmentedControlItemV2>
            )}
          </For>
        </SegmentedControlV2>
      </div>

      <div class="min-h-0 flex-1">
        <Show when={view() === "attention"}>
          <div class="h-full overflow-y-auto px-3 pb-6 pt-2 sm:px-6">
            <ul class="mx-auto flex max-w-[840px] flex-col gap-1">
              <Show when={(googleStatus()?.failedWrites ?? 0) > 0}>
                <AttentionRow
                  tone="critical"
                  title={language.t("secondBrain.activity.googleFailed", { count: googleStatus()?.failedWrites ?? 0 })}
                  detail={language.t("secondBrain.activity.googleFailedDetail")}
                  onOpen={() => navigate("/calendar?google=connect")}
                />
              </Show>
              <Show when={(googleStatus()?.pendingWrites ?? 0) > 0}>
                <AttentionRow
                  title={language.t("secondBrain.activity.googlePending", {
                    count: googleStatus()?.pendingWrites ?? 0,
                  })}
                  detail={language.t("secondBrain.activity.googlePendingDetail")}
                  onOpen={() => navigate("/calendar")}
                />
              </Show>
              <For each={attention()}>
                {(record) => {
                  const approvals = () =>
                    home.server.focusedSync().session.data.permission[record.session.id]?.length ?? 0
                  return (
                    <li>
                      <button type="button" class={pageRowClass} onClick={() => sessions.session.open(record.session)}>
                        <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent animate-[running-pulse_1.6s_var(--v2-ease-standard)_infinite] motion-reduce:animate-none" />
                        <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:470]">
                          {record.session.title}
                        </span>
                        <Show
                          when={approvals() > 0}
                          fallback={
                            <span class="shrink-0 text-[12px] text-v2-text-text-faint">
                              {language.t("secondBrain.activity.question")}
                            </span>
                          }
                        >
                          <span class="shrink-0 rounded-full bg-v2-state-bg-warning px-2 py-0.5 text-[11px] text-v2-state-fg-warning">
                            {language.t("secondBrain.activity.approvals", { count: approvals() })}
                          </span>
                        </Show>
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>
            <Show
              when={
                !google.loading &&
                !sessions.data.loading() &&
                attention().length === 0 &&
                !(googleStatus()?.pendingWrites || googleStatus()?.failedWrites)
              }
            >
              <PageEmpty>{language.t("secondBrain.activity.attentionEmpty")}</PageEmpty>
            </Show>
          </div>
        </Show>
        <Show when={view() === "changes"}>
          <div class="h-full overflow-y-auto px-3 pb-6 pt-2 sm:px-6">
            <Show
              when={changes().length > 0}
              fallback={
                <Show when={!sessions.data.loading()}>
                  <PageEmpty>{language.t("secondBrain.activity.changesEmpty")}</PageEmpty>
                </Show>
              }
            >
              <ul class="mx-auto flex max-w-[840px] flex-col gap-1">
                <For each={changes()}>
                  {(record) => (
                    <li>
                      <button type="button" class={pageRowClass} onClick={() => sessions.session.open(record.session)}>
                        <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:470]">
                          {record.session.title}
                        </span>
                        <span class="max-w-40 shrink-0 truncate text-[12px] text-v2-text-text-faint">
                          {record.projectName}
                        </span>
                        <span class="shrink-0 text-right text-[12px] tabular-nums text-v2-text-text-muted">
                          {language.t("secondBrain.activity.changeSummary", {
                            files: record.session.summary?.files ?? 0,
                            additions: record.session.summary?.additions ?? 0,
                            deletions: record.session.summary?.deletions ?? 0,
                          })}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
        <Show when={view() === "runs"}>
          <div class="h-full overflow-y-auto px-3 pb-6 pt-2 sm:px-6">
            <Show
              when={runs().length > 0}
              fallback={
                <Show when={!sessions.data.loading()}>
                  <PageEmpty>{language.t("secondBrain.activity.runsEmpty")}</PageEmpty>
                </Show>
              }
            >
              <ul
                class="mx-auto flex max-w-[840px] flex-col gap-1"
                aria-label={language.t("secondBrain.activity.view.runs")}
              >
                <For each={runs()}>
                  {(run) => (
                    <li>
                      <button
                        type="button"
                        class={pageRowClass}
                        onClick={() => sessions.session.open(run.record.session)}
                      >
                        <span
                          classList={{
                            "size-2 shrink-0 rounded-full": true,
                            "bg-v2-icon-icon-accent animate-[running-pulse_1.6s_var(--v2-ease-standard)_infinite] motion-reduce:animate-none":
                              run.status === "running",
                            "bg-v2-state-fg-warning": run.status === "approval" || run.status === "retrying",
                          }}
                        />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-[13px] text-v2-text-text-base [font-weight:470]">
                            {run.record.session.title}
                          </span>
                          <span class="block truncate text-[12px] text-v2-text-text-faint">
                            {[
                              run.record.projectName,
                              run.record.session.agent,
                              getRelativeTime(new Date(run.record.session.time.updated).toISOString(), language.t),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <Show when={run.status}>
                          {(status) => (
                            <span
                              classList={{
                                "shrink-0 rounded-full px-2 py-0.5 text-[11px]": true,
                                "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container":
                                  status() === "running",
                                "bg-v2-state-bg-warning text-v2-state-fg-warning": status() !== "running",
                              }}
                            >
                              {language.t(`secondBrain.activity.run.${status()}`)}
                            </span>
                          )}
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>
        <Show when={view() === "history"}>
          <ScrollView
            class="h-full [container-type:size]"
            thumbContainer={scroll.viewport.thumbTrack}
            thumbHoverTarget={scroll.viewport.hoverTarget}
            viewportRef={scroll.viewport.setViewport}
            onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
            onWheel={scroll.viewport.containOuterWheel}
          >
            <div class="mx-auto flex min-h-full w-full max-w-[840px] px-4 sm:px-6">
              <HomeSessions sessions={sessions} search={search} scroll={scroll} />
            </div>
          </ScrollView>
        </Show>
      </div>
    </PageFrame>
  )
}

type ActivityView = (typeof activityViews)[number]
const activityViews = ["attention", "runs", "changes", "history"] as const

function AttentionRow(props: { title: string; detail: string; tone?: "critical"; onOpen: () => void }) {
  return (
    <li>
      <div role={props.tone === "critical" ? "alert" : "status"}>
        <button type="button" class={pageRowClass} onClick={props.onOpen}>
          <span
            classList={{
              "size-2 shrink-0 rounded-full": true,
              "bg-v2-state-fg-danger": props.tone === "critical",
              "bg-v2-state-fg-warning": props.tone !== "critical",
            }}
          />
          <span class="min-w-0 flex-1">
            <span
              classList={{
                "block truncate text-[13px] [font-weight:530]": true,
                "text-v2-state-fg-danger": props.tone === "critical",
                "text-v2-text-text-base": props.tone !== "critical",
              }}
            >
              {props.title}
            </span>
            <span class="block truncate text-[12px] text-v2-text-text-muted">{props.detail}</span>
          </span>
        </button>
      </div>
    </li>
  )
}
